// Chromium cannot decode AC3/DTS or demux every MKV. Keep HTML controls and feed H264/AAC HLS.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../../shared/types';
import { mediaRuntimesDir, resourcesDir } from '../util/paths';

const SEGMENT_SECONDS = 6;
const BLOCK_BYTES = 512 * 1024;
const INPUT_BLOCK_CACHE_MAX = 12;
const MAX_SEGMENTS_PER_SESSION = 4;
const MAX_ACTIVE_SEGMENT_JOBS = 2;
export const HTML_MEDIA_MAX_CACHED_SEGMENT_BYTES = 64 * 1024 * 1024;
// Remote UC/Baidu media can require a long initial seek before ffmpeg emits
// the first compatible segment. Keep this above the browser HLS timeout so a
// slow-but-progressing transcode is not reported as a network failure.
const SOURCE_RANGE_TIMEOUT_MS = 120_000;
const FFMPEG_IO_TIMEOUT_US = 120_000_000;
const PROBE_TIMEOUT_MS = 180_000;
const SEGMENT_TIMEOUT_MS = 180_000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const EXPIRY_SWEEP_MS = 60_000;
type Input = { source: string; size: number; expires: number; blocks: Map<number, Buffer>; pending: Map<number, Promise<Buffer>>; controller: AbortController; procs: Set<ChildProcess> };
type Session = { ffmpeg: string; source: string; duration: number; expires: number; segments: Map<number, Buffer>; pending: Map<number, Promise<Buffer>>; procs: Set<ChildProcess> };

export function htmlMediaPlan(probe: any): { duration: number; compatible: boolean } {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((s: any) => s.codec_type === 'video');
  const audio = streams.find((s: any) => s.codec_type === 'audio');
  const duration = Number(probe?.format?.duration) || 0;
  const mp4 = /\b(mp4|mov)\b/.test(String(probe?.format?.format_name || ''));
  return { duration, compatible: mp4 && video?.codec_name === 'h264' && ['yuv420p', 'yuvj420p'].includes(video.pix_fmt) && (!audio || ['aac', 'mp3'].includes(audio.codec_name)) };
}

export function htmlMediaToolsAvailable(ffprobe: string, ffmpeg: string, exists: (path: string) => boolean = path => existsSync(path)): boolean {
  return exists(ffprobe) && exists(ffmpeg);
}

function ffmpegExecutables(): { ffmpeg: string; ffprobe: string } {
  const runtimeRoot = join(mediaRuntimesDir(), 'ffmpeg');
  try {
    const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'active.json'), 'utf8')) as { relativeBinDir?: unknown };
    const relative = typeof manifest.relativeBinDir === 'string' ? manifest.relativeBinDir : '';
    if (relative && !isAbsolute(relative) && !relative.split(/[\\/]/).some(part => part === '..')) {
      const base = resolve(runtimeRoot);
      const bin = resolve(base, ...relative.split(/[\\/]/));
      if (bin.startsWith(base + sep) && htmlMediaToolsAvailable(join(bin, 'ffprobe.exe'), join(bin, 'ffmpeg.exe'))) {
        return { ffprobe: join(bin, 'ffprobe.exe'), ffmpeg: join(bin, 'ffmpeg.exe') };
      }
    }
  } catch { /* optional download missing or metadata damaged; try packaged tools */ }
  const bundled = join(resourcesDir(), 'ffmpeg');
  return { ffprobe: join(bundled, 'ffprobe.exe'), ffmpeg: join(bundled, 'ffmpeg.exe') };
}

export function htmlPlaylist(duration: number): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  for (let i = 0; i < Math.ceil(duration / SEGMENT_SECONDS); i++) {
    if (i) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${Math.min(SEGMENT_SECONDS, duration - i * SEGMENT_SECONDS).toFixed(3)},`, `${i}.ts`);
  }
  return lines.concat('#EXT-X-ENDLIST', '').join('\n');
}

export class HtmlMedia {
  private sessions = new Map<string, Session>();
  private inputs = new Map<string, Input>();
  /** 全部 HTML 兼容会话共用一个 LRU 字节预算，避免每会话 4 段叠加成数百 MB。 */
  private segmentLru = new Map<string, { sessionId: string; index: number; buffer: Buffer }>();
  private cachedSegmentBytes = 0;
  private activeSegmentJobs = 0;
  private maxCachedSegmentBytes = HTML_MEDIA_MAX_CACHED_SEGMENT_BYTES;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private log: Logger) {}

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expires <= now) this.release(id);
    for (const [id, input] of this.inputs) if (input.expires <= now) this.release(id);
  }

  private scheduleExpirySweep(): void {
    if (this.expiryTimer || (!this.inputs.size && !this.sessions.size)) return;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.pruneExpired();
      this.scheduleExpirySweep();
    }, EXPIRY_SWEEP_MS);
    this.expiryTimer.unref?.();
  }

  private segmentKey(sessionId: string, index: number): string {
    return `${sessionId}:${index}`;
  }

  private removeCachedSegment(sessionId: string, index: number, session = this.sessions.get(sessionId)): void {
    const key = this.segmentKey(sessionId, index);
    const cached = this.segmentLru.get(key);
    if (cached) {
      this.segmentLru.delete(key);
      this.cachedSegmentBytes = Math.max(0, this.cachedSegmentBytes - cached.buffer.byteLength);
    }
    if (!session || !cached || session.segments.get(index) === cached.buffer) session?.segments.delete(index);
  }

  private touchCachedSegment(sessionId: string, session: Session, index: number, buffer: Buffer): void {
    const key = this.segmentKey(sessionId, index);
    const cached = this.segmentLru.get(key);
    if (cached?.buffer !== buffer) return;
    this.segmentLru.delete(key);
    this.segmentLru.set(key, cached);
    session.segments.delete(index);
    session.segments.set(index, buffer);
  }

  private cacheSegment(sessionId: string, session: Session, index: number, buffer: Buffer): void {
    if (buffer.byteLength > this.maxCachedSegmentBytes) return;
    this.removeCachedSegment(sessionId, index, session);
    const key = this.segmentKey(sessionId, index);
    session.segments.set(index, buffer);
    this.segmentLru.set(key, { sessionId, index, buffer });
    this.cachedSegmentBytes += buffer.byteLength;

    while (session.segments.size > MAX_SEGMENTS_PER_SESSION) {
      const oldest = session.segments.keys().next().value;
      if (oldest === undefined) break;
      this.removeCachedSegment(sessionId, oldest, session);
    }
    while (this.cachedSegmentBytes > this.maxCachedSegmentBytes) {
      const oldest = this.segmentLru.values().next().value;
      if (!oldest) break;
      this.removeCachedSegment(oldest.sessionId, oldest.index);
    }
  }

  private run(exe: string, args: string[], timeout: number, owner?: { procs: Set<ChildProcess> }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const proc = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      owner?.procs.add(proc);
      let size = 0;
      let stderr = '';
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); owner?.procs.delete(proc);
        if (error) { proc.kill(); reject(error); } else resolve(Buffer.concat(chunks));
      };
      const timer = setTimeout(() => finish(new Error('媒体兼容处理超时')), timeout);
      proc.stdout.on('data', (b: Buffer) => {
        size += b.length;
        if (size > 32 * 1024 * 1024) { finish(new Error('媒体分片超过缓存上限')); return; }
        chunks.push(b);
      });
      // Retain only a short diagnostic tail; filter credential-bearing lines before logging.
      proc.stderr.on('data', (b: Buffer) => { stderr = (stderr + b.toString('utf8')).slice(-4096); });
      proc.once('error', e => finish(e));
      proc.once('close', code => {
        if (code && !settled) this.log.w(`html-media: ${stderr.split(/\r?\n/).filter(l => l && !/https?:|\/play\?|cookie|header|token/i.test(l)).slice(-3).join(' ').slice(0, 300)}`);
        finish(code === 0 ? undefined : new Error(`媒体兼容处理失败（${code}）`));
      });
    });
  }

  stop(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    for (const id of new Set([...this.inputs.keys(), ...this.sessions.keys()])) this.release(id);
  }
  private release(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      for (const p of s.procs) p.kill();
      for (const index of s.segments.keys()) this.removeCachedSegment(id, index, s);
      s.pending.clear();
      s.procs.clear();
    }
    this.sessions.delete(id);
    const input = this.inputs.get(id);
    input?.controller.abort();
    if (input) {
      for (const p of input.procs) p.kill();
      input.blocks.clear();
      input.pending.clear();
      input.procs.clear();
    }
    this.inputs.delete(id);
    if (!this.inputs.size && !this.sessions.size && this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private async block(input: Input, n: number): Promise<Buffer> {
    const cached = input.blocks.get(n);
    if (cached) return cached;
    let task = input.pending.get(n);
    if (!task) {
      task = (async () => {
        const start = n * BLOCK_BYTES;
        const end = input.size ? Math.min(input.size - 1, start + BLOCK_BYTES - 1) : start + BLOCK_BYTES - 1;
        const response = await fetch(input.source, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.any([input.controller.signal, AbortSignal.timeout(SOURCE_RANGE_TIMEOUT_MS)]) });
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (response.status !== 206 || !range || Number(range[1]) !== start) {
          await response.body?.cancel(); throw new Error('媒体源未返回有效 Range 数据');
        }
        input.size = Number(range[3]);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length !== Number(range[2]) - start + 1 || buffer.length > BLOCK_BYTES) throw new Error('媒体 Range 长度不完整');
        input.blocks.set(n, buffer);
        while (input.blocks.size > INPUT_BLOCK_CACHE_MAX) input.blocks.delete(input.blocks.keys().next().value!);
        return buffer;
      })();
      input.pending.set(n, task);
      task.finally(() => input.pending.delete(n)).catch(() => undefined);
    }
    return task;
  }

  private async inputResponse(input: Input, req: IncomingMessage, res: ServerResponse): Promise<void> {
    input.expires = Date.now() + SESSION_TTL_MS;
    if (!input.size) await this.block(input, 0);
    const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(input.size - 1, Number(match[2])) : input.size - 1;
    if (start > end || !Number.isSafeInteger(start) || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${input.size}` }); res.end(); return; }
    res.writeHead(match ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${input.size}` } : {}) });
    if (req.method === 'HEAD') { res.end(); return; }
    for (let pos = start; pos <= end && !res.destroyed;) {
      const n = Math.floor(pos / BLOCK_BYTES);
      const buffer = await this.block(input, n);
      if (res.destroyed) return;
      const count = Math.min(buffer.length - pos % BLOCK_BYTES, end - pos + 1);
      if (count <= 0) throw new Error('媒体块为空');
      if (!res.write(buffer.subarray(pos % BLOCK_BYTES, pos % BLOCK_BYTES + count))) {
        await new Promise<void>(resolve => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
          res.once('drain', done); res.once('close', done);
        });
      }
      pos += count;
    }
    if (!res.destroyed) res.end();
  }

  async handle(u: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const json = (status: number, value: unknown) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    this.pruneExpired();
    try {
      const inputMatch = /^\/html\/([a-f0-9-]+)\/source$/.exec(u.pathname);
      if (inputMatch) {
        const input = this.inputs.get(inputMatch[1]);
        if (!input) { json(404, { error: '媒体输入已结束' }); return; }
        await this.inputResponse(input, req, res); return;
      }
      if (u.pathname === '/html/prepare') {
        const source = u.searchParams.get('url') || '';
        const local = new URL(source);
        // Credentials stay on the existing local relay; never pass an arbitrary input to FFmpeg.
        if (local.hostname !== '127.0.0.1' || local.port !== String(req.socket.localPort) || !['/play', '/bt'].some(p => local.pathname === p || local.pathname.startsWith(p + '/'))) {
          json(400, { error: '无效的本地播放地址' }); return;
        }
        const tools = ffmpegExecutables();
        const ffprobe = tools.ffprobe;
        const ffmpeg = tools.ffmpeg;
        if (!htmlMediaToolsAvailable(ffprobe, ffmpeg)) {
          this.log.w('html-media: 未找到 FFmpeg/ffprobe，改用 HTML5 直连；不支持的编码仍需安装媒体组件或切换 MPV');
          json(200, { url: source });
          return;
        }
        while (this.inputs.size >= 6) this.release(this.inputs.keys().next().value!);
        const id = randomUUID();
        const input: Input = { source, size: 0, expires: Date.now() + SESSION_TTL_MS, blocks: new Map(), pending: new Map(), controller: new AbortController(), procs: new Set() };
        this.inputs.set(id, input);
        this.scheduleExpirySweep();
        // Cancel the probe immediately when the player switches source or closes its request.
        const cancelPrepare = () => { if (!res.writableEnded) this.release(id); };
        res.once('close', cancelPrepare);
        const inputUrl = `http://127.0.0.1:${req.socket.localPort}/html/${id}/source`;
        let info: any;
        try {
          info = await this.run(ffprobe, ['-v', 'error', '-rw_timeout', String(FFMPEG_IO_TIMEOUT_US), '-analyzeduration', '1000000', '-probesize', '524288', '-show_streams', '-show_format', '-of', 'json', inputUrl], PROBE_TIMEOUT_MS, input).then(b => JSON.parse(b.toString('utf8')));
        } catch (e) { this.release(id); throw e; }
        finally { res.off('close', cancelPrepare); }
        const plan = htmlMediaPlan(info);
        const video = info.streams?.find((s: any) => s.codec_type === 'video');
        const resolution = { width: video?.width, height: video?.height };
        this.log.i(`html-media: ${JSON.stringify({ format: info.format?.format_name, streams: info.streams?.map((s: any) => ({ type: s.codec_type, codec: s.codec_name, pix: s.pix_fmt })), compatible: plan.compatible })}`);
        if (res.destroyed) { this.release(id); return; }
        if (plan.compatible) { this.release(id); json(200, { url: source, ...resolution }); return; }
        if (plan.duration <= 0 || plan.duration > 86400) { this.release(id); throw new Error('无法读取点播媒体时长'); }
        while (this.sessions.size >= 6) this.release(this.sessions.keys().next().value!);
        this.sessions.set(id, { ffmpeg, source: inputUrl, duration: plan.duration, expires: Date.now() + SESSION_TTL_MS, segments: new Map(), pending: new Map(), procs: new Set() });
        this.log.i('html-media: 使用 H264/AAC 兼容流（保留 HTML 播放与拖动）');
        json(200, { url: `http://127.0.0.1:${req.socket.localPort}/html/${id}/index.m3u8`, session: id, ...resolution });
        return;
      }
      const m = /^\/html\/([a-f0-9-]+)\/(index\.m3u8|release|\d+\.ts)$/.exec(u.pathname);
      const s = m ? this.sessions.get(m[1]) : undefined;
      if (!m || !s) { json(404, { error: '媒体会话已结束' }); return; }
      if (m[2] === 'release') { this.release(m[1]); json(200, { ok: true }); return; }
      s.expires = Date.now() + SESSION_TTL_MS;
      if (m[2] === 'index.m3u8') {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(htmlPlaylist(s.duration)); return;
      }
      const n = Number(m[2].split('.')[0]);
      if (!Number.isSafeInteger(n) || n < 0 || n * SEGMENT_SECONDS >= s.duration) { json(404, { error: '无效分片' }); return; }
      let buffer = s.segments.get(n);
      if (buffer) this.touchCachedSegment(m[1], s, n, buffer);
      if (!buffer) {
        let work = s.pending.get(n);
        if (!work) {
          if (s.pending.size >= 2) { json(503, { error: '正在处理媒体分片' }); return; }
          if (this.activeSegmentJobs >= MAX_ACTIVE_SEGMENT_JOBS) { json(503, { error: '媒体兼容处理繁忙，请稍后重试' }); return; }
          const start = n * SEGMENT_SECONDS;
          this.activeSegmentJobs++;
          work = this.run(s.ffmpeg, [
            '-v', 'error', '-nostdin', '-rw_timeout', String(FFMPEG_IO_TIMEOUT_US), '-analyzeduration', '1000000', '-probesize', '524288', '-ss', String(start), '-i', s.source,
            '-t', String(Math.min(SEGMENT_SECONDS, s.duration - start)), '-map', '0:v:0?', '-map', '0:a:0?',
            '-sn', '-dn', '-threads', '2',
            '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-g', '180', '-sc_threshold', '0',
            '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000', '-f', 'mpegts', 'pipe:1',
          ], SEGMENT_TIMEOUT_MS, s).finally(() => { this.activeSegmentJobs = Math.max(0, this.activeSegmentJobs - 1); });
          s.pending.set(n, work);
          work.finally(() => s.pending.delete(n)).catch(() => undefined);
        }
        buffer = await work;
        if (this.sessions.get(m[1]) !== s) { json(410, { error: '媒体会话已结束' }); return; }
        this.cacheSegment(m[1], s, n, buffer);
      }
      if (res.destroyed) return;
      res.writeHead(200, { ...cors, 'Content-Type': 'video/mp2t', 'Content-Length': String(buffer.length) });
      res.end(req.method === 'HEAD' ? undefined : buffer);
    } catch (e) {
      if (!res.destroyed && !res.headersSent) json(502, { error: e instanceof Error ? e.message : '媒体兼容处理失败' });
      else if (!res.destroyed) res.destroy();
    }
  }
}
