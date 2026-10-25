import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }));
import { htmlMediaPlan, htmlMediaToolsAvailable, htmlPlaylist, HTML_MEDIA_MAX_CACHED_SEGMENT_BYTES } from '../src/main/player/HtmlMedia';
import { HtmlMedia } from '../src/main/player/HtmlMedia';
import { createServer } from 'node:http';
import { afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
const fsMocks = vi.hoisted(() => ({ existsSync: vi.fn((_path: unknown) => true) }));
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), existsSync: fsMocks.existsSync }));
beforeEach(() => fsMocks.existsSync.mockReturnValue(true));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('HTML media codec compatibility', () => {
  const video = { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' };
  const probe = (audio: string, format = 'mov,mp4,m4a,3gp,3g2,mj2', v = video) => ({ format: { duration: '62.25', format_name: format }, streams: [v, { codec_type: 'audio', codec_name: audio }] });
  it('keeps directly supported MP4; converts unsupported audio, container or video', () => {
    expect(htmlMediaPlan(probe('aac'))).toEqual({ duration: 62.25, compatible: true });
    for (const codec of ['ac3', 'eac3', 'dts']) expect(htmlMediaPlan(probe(codec)).compatible).toBe(false);
    expect(htmlMediaPlan(probe('aac', 'matroska,webm')).compatible).toBe(false);
    expect(htmlMediaPlan(probe('aac', 'mp4', { ...video, codec_name: 'hevc' })).compatible).toBe(false);
    expect(htmlMediaPlan(probe('aac', 'mp4', { ...video, pix_fmt: 'yuv420p10le' })).compatible).toBe(false);
  });
  it('requires both FFmpeg tools for conversion and allows the caller to fall back when missing', () => {
    expect(htmlMediaToolsAvailable('ffprobe.exe', 'ffmpeg.exe', () => true)).toBe(true);
    expect(htmlMediaToolsAvailable('ffprobe.exe', 'ffmpeg.exe', path => path === 'ffprobe.exe')).toBe(false);
    expect(HTML_MEDIA_MAX_CACHED_SEGMENT_BYTES).toBe(64 * 1024 * 1024);
  });
  it('returns the original playback URL when one FFmpeg tool is missing', async () => {
    fsMocks.existsSync.mockImplementation(path => !String(path).endsWith('ffmpeg.exe'));
    const media = new HtmlMedia({ i: vi.fn(), w: vi.fn(), e: vi.fn() });
    const server = createServer((req, res) => { void media.handle(new URL(req.url!, 'http://localhost'), req, res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const source = `http://127.0.0.1:${port}/play?url=${encodeURIComponent('https://media.test/movie.mkv')}`;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/html/prepare?url=${encodeURIComponent(source)}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ url: source });
      expect(fsMocks.existsSync).toHaveBeenCalledWith(expect.stringMatching(/[\\/]ffmpeg[\\/]ffmpeg\.exe$/i));
      expect((media as any).inputs.size).toBe(0);
    } finally {
      media.stop();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('playlist covers exact duration and isolates independent timestamps for seeking', () => {
    const list = htmlPlaylist(14.25);
    expect(list).toContain('#EXTINF:2.250,\n2.ts');
    expect(list.match(/#EXT-X-DISCONTINUITY/g)).toHaveLength(2);
    const duration = [...list.matchAll(/#EXTINF:([0-9.]+)/g)].reduce((s,m) => s + Number(m[1]), 0);
    expect(duration).toBe(14.25);
    expect(list).toContain('#EXT-X-ENDLIST');
  });
  it('uses the FFmpeg executable saved with a compatibility session for each segment', async () => {
    const media = new HtmlMedia({ i: vi.fn(), w: vi.fn(), e: vi.fn() }) as any;
    media.sessions.set('abc', {
      ffmpeg: 'managed-ffmpeg.exe', source: 'http://127.0.0.1:9978/play?url=media', duration: 12,
      expires: Date.now() + 60_000, segments: new Map(), pending: new Map(), procs: new Set(),
    });
    media.run = vi.fn(async () => Buffer.from('fake-ts-segment'));
    const server = createServer((req, res) => { void media.handle(new URL(req.url!, 'http://localhost'), req, res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/html/abc/0.ts`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('fake-ts-segment');
      expect(media.run).toHaveBeenCalledOnce();
      expect(media.run.mock.calls[0][0]).toBe('managed-ffmpeg.exe');
    } finally { media.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('cached input serves overlapping byte ranges without re-fetching blocks', async () => {
    const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
    const upstream = vi.fn(async () => new Response(bytes, { status: 206, headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` } }));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', upstream);
    const media = new HtmlMedia({ i: vi.fn(), w: vi.fn(), e: vi.fn() });
    (media as any).inputs.set('abc', { source: 'http://relay/play', size: 0, expires: Date.now() + 60000, blocks: new Map(), pending: new Map(), controller: new AbortController(), procs: new Set() });
    const server = createServer((req, res) => { void media.handle(new URL(req.url!, 'http://localhost'), req, res); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as any).port}/html/abc/source`;
      const response = await originalFetch(base, { headers: { Range: 'bytes=4-9' } });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(`bytes 4-9/${bytes.length}`);
      expect(await response.text()).toBe('456789');
      const other = await originalFetch(base, { headers: { Range: 'bytes=8-' } });
      expect(await other.text()).toBe(bytes.subarray(8).toString());
      expect(upstream).toHaveBeenCalledTimes(1);
      const invalid = await originalFetch(base, { headers: { Range: 'bytes=99-' } });
      expect(invalid.status).toBe(416);
    } finally { media.stop(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  });
  it('bounds cached segment buffers across sessions and evicts least recently used segments', () => {
    const media = new HtmlMedia({ i: vi.fn(), w: vi.fn(), e: vi.fn() }) as any;
    const makeSession = () => ({ source: '', duration: 18, expires: Date.now() + 60000, segments: new Map(), pending: new Map(), procs: new Set() });
    const first = makeSession();
    const second = makeSession();
    const third = makeSession();
    media.maxCachedSegmentBytes = 14;
    media.sessions.set('first', first);
    media.sessions.set('second', second);
    media.sessions.set('third', third);
    const firstBuffer = Buffer.alloc(7);
    const secondBuffer = Buffer.alloc(7);
    const thirdBuffer = Buffer.alloc(7);
    media.cacheSegment('first', first, 0, firstBuffer);
    media.cacheSegment('second', second, 0, secondBuffer);
    media.touchCachedSegment('first', first, 0, firstBuffer);
    media.cacheSegment('third', third, 0, thirdBuffer);
    expect(first.segments.get(0)).toBe(firstBuffer);
    expect(second.segments.has(0)).toBe(false);
    expect(third.segments.get(0)).toBe(thirdBuffer);
    expect(media.cachedSegmentBytes).toBe(14);
    media.release('first');
    expect(media.cachedSegmentBytes).toBe(7);
  });
  it('returns a retryable response when the global FFmpeg segment worker limit is full', async () => {
    const media = new HtmlMedia({ i: vi.fn(), w: vi.fn(), e: vi.fn() }) as any;
    media.sessions.set('abc', { source: 'http://127.0.0.1/source', duration: 12, expires: Date.now() + 60000, segments: new Map(), pending: new Map(), procs: new Set() });
    media.activeSegmentJobs = 2;
    const server = createServer((req, res) => { void media.handle(new URL(req.url!, 'http://localhost'), req, res); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/html/abc/0.ts`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: '媒体兼容处理繁忙，请稍后重试' });
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  });

  it('cancels an abandoned media probe and releases its input buffers immediately', async () => {
    const media = new HtmlMedia({ i: vi.fn(), w: vi.fn(), e: vi.fn() }) as any;
    let input: any;
    const kill = vi.fn();
    media.run = vi.fn((_exe: string, _args: string[], _timeout: number, owner: any) => new Promise((_resolve, reject) => {
      input = owner;
      owner.blocks.set(0, Buffer.alloc(16));
      owner.procs.add({ kill: () => { kill(); reject(new Error('cancelled')); } });
    }));
    const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, headersSent: false, writeHead: vi.fn(), end: vi.fn() });
    const request = { socket: { localPort: 9978 }, headers: {}, method: 'GET' };
    const url = new URL('http://127.0.0.1:9978/html/prepare');
    url.searchParams.set('url', 'http://127.0.0.1:9978/play?url=media');
    const pending = media.handle(url, request, response);
    expect(media.inputs.size).toBe(1);
    response.destroyed = true;
    response.emit('close');
    await pending;
    expect(kill).toHaveBeenCalledOnce();
    expect(input.controller.signal.aborted).toBe(true);
    expect(input.blocks.size).toBe(0);
    expect(media.inputs.size).toBe(0);
    expect(media.expiryTimer).toBeNull();
  });

  it('expires abandoned sessions without needing another incoming request', () => {
    vi.useFakeTimers();
    const media = new HtmlMedia({ i: vi.fn(), w: vi.fn(), e: vi.fn() }) as any;
    const input = { source: '', size: 16, expires: Date.now() + 1000, blocks: new Map([[0, Buffer.alloc(16)]]), pending: new Map(), procs: new Set(), controller: new AbortController() };
    const session = { source: '', duration: 18, expires: input.expires, segments: new Map(), pending: new Map(), procs: new Set() };
    media.inputs.set('abc', input);
    media.sessions.set('abc', session);
    media.cacheSegment('abc', session, 0, Buffer.alloc(16));
    media.scheduleExpirySweep();
    vi.advanceTimersByTime(60_000);
    expect(media.inputs.size).toBe(0);
    expect(media.sessions.size).toBe(0);
    expect(input.blocks.size).toBe(0);
    expect(media.cachedSegmentBytes).toBe(0);
    expect(media.expiryTimer).toBeNull();
    media.stop();
  });
});
