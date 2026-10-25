import { createHash } from 'node:crypto';
import { validateHeaderValue, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Logger } from '../../shared/types';
import { isHlsPlaylistUrl } from '../../shared/playbackResult';
import { mergeSetCookies, setCookieList, cookiePairOf } from '../net/cookieMerge';
import { purifyVodM3u8 } from '../../engine/util/m3u8Purify';
import { logPlayDiag, redactUrl } from '../util/playDiag';
import { imagePreludeLen, parseByteRange } from './mediaTransforms';
import { partialRangeTotal, RangeAggregateStream } from './RangeAggregateStream';
import { UpstreamHttpClient } from './UpstreamHttpClient';
import { decodeProxyHeaders, headerValue, hlsProxyTarget, rewriteM3u8WithHeaders, safeProxyRequestHeaders } from './hlsProxyTransforms';

export interface PlaybackRelayPorts {
  logger: Logger;
  driveTokens?: () => Record<string, string>;
  purify?: { enabled: () => boolean; rulesFor: (url: string) => string[] };
  davAuth?: (id: string) => string;
  aggregateStream: RangeAggregateStream;
  upstream: UpstreamHttpClient;
  proxyBase: () => string;
  speedReporter: () => ((kbs: number) => void) | undefined;
}

const DETECT_HEAD_LEN = 128 * 1024;

/** Owns playback URL policy, upstream sessions, HLS rewriting, and byte-stream relay. */
export class PlaybackRelayService {
  private readonly playCookieJar = new Map<string, string[]>();
  private readonly baiduPlayNodes = new Map<string, { url: string; expires: number }>();
  private readonly logger: Logger;
  private readonly aggregateStream: RangeAggregateStream;
  private readonly upstream: UpstreamHttpClient;

  constructor(private readonly ports: PlaybackRelayPorts) {
    this.logger = ports.logger;
    this.aggregateStream = ports.aggregateStream;
    this.upstream = ports.upstream;
  }

  private get driveTokens() { return this.ports.driveTokens; }
  private get purify() { return this.ports.purify; }
  private get davAuth() { return this.ports.davAuth; }
  private get onSpeed() { return this.ports.speedReporter(); }

  stop(): void {
    this.playCookieJar.clear();
    this.baiduPlayNodes.clear();
  }

  handlePlay(u: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.playProxy(u, req, res);
  }

  handleM3u8(u: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.m3u8Proxy(u, req, res);
  }

  private applyPlayCookieJar(provider: string, base: string): string {
    const pairs = this.playCookieJar.get(provider);
    return pairs && pairs.length ? mergeSetCookies(base, pairs) : base;
  }

  /** 记录上游响应里的 Set-Cookie（同名覆盖，保留最近 20 条） */
  private rememberPlaySetCookies(provider: string, headers: Record<string, unknown>): void {
    const lines = setCookieList(headers['set-cookie']);
    if (!lines.length) return;
    const keep = (this.playCookieJar.get(provider) || []).slice();
    for (const line of lines) {
      const kv = cookiePairOf(line);
      if (kv) keep.push(`${kv[0]}=${kv[1]}`);
    }
    this.playCookieJar.set(provider, keep.slice(-20));
  }

  private async m3u8Proxy(u: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CatVod Adm3u8 carries the manifest URL as Base64. It uses the same
    // playlist/segment relay contract; no Android/JVM player is required.
    u.searchParams.set('url', hlsProxyTarget(u));
    const target = u.searchParams.get('url') || '';
    if (!/^https?:\/\//i.test(target)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('missing or invalid url');
      return;
    }
    return this.playProxy(u, req, res, true);
  }

  /** /play：透传 + 注入自定义 UA/Referer；ck=<provider> 时按网盘 provider 注入 Cookie，并对 m3u8 重写片段地址 */
  private async playProxy(u: URL, req: IncomingMessage, res: ServerResponse, playlistHint = false): Promise<void> {
    let target = u.searchParams.get('url') || '';
    const hlsResource = u.searchParams.get('hlsResource') || '';
    const assetHint = hlsResource === 'asset';
    if (hlsResource === 'playlist') playlistHint = true;
    const ua = u.searchParams.get('ua') || '';
    const referer = u.searchParams.get('referer') || '';
    const ck = u.searchParams.get('ck') || '';
    let relayHeaders = decodeProxyHeaders(u.searchParams.get('headers') || '');
    if (relayHeaders === null) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('invalid headers');
      return;
    }
    const proxyBase = this.ports.proxyBase();
    // SpiderHost 会再给本机 m3u8 地址包 /play。合并这两层协议上下文，
    // 否则 playerContent.header 只发到 localhost，真正的 CDN 请求拿不到。
    let inner: URL | undefined;
    try {
      const candidate = new URL(target);
      if (candidate.origin === proxyBase && candidate.pathname === '/proxy' && ['m3u8', 'Adm3u8'].includes(candidate.searchParams.get('do') || '')) inner = candidate;
    } catch { /* 非本机 m3u8 入口按旧行为转发 */ }
    if (inner) {
      const innerTarget = hlsProxyTarget(inner);
      const innerHeaders = decodeProxyHeaders(inner.searchParams.get('headers') || '');
      if (!/^https?:\/\//i.test(innerTarget) || innerHeaders === null) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(innerHeaders === null ? 'invalid headers' : 'missing or invalid url');
        return;
      }
      relayHeaders = safeProxyRequestHeaders({ ...innerHeaders, ...relayHeaders });
      target = innerTarget;
      playlistHint = true;
    }
    const rawCookie = u.searchParams.get('cookie') || headerValue(relayHeaders, 'cookie'); // 蜘蛛 header 直接给的原始 Cookie
    const dav = u.searchParams.get('dav') || '';
    if (!target) {
      res.writeHead(400);
      res.end('missing url'); return;
    }
    const headers: Record<string, string> = {};
    Object.assign(headers, relayHeaders);
    if (ua) headers['User-Agent'] = ua;
    if (referer) headers['Referer'] = referer;
    // ★ 2026-09-29 WebDAV：凭据从主进程加密存储取（`dav=<id>`），只注入 Authorization
    if (dav) {
      const auth = this.davAuth ? this.davAuth(dav) : '';
      if (!auth) {
        this.logger.w(`proxy /play: WebDAV 服务器不可用或未填凭据（dav=${dav}）`);
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('WebDAV 服务器不存在或凭据缺失，请在配置页「存储」中检查');
        return;
      }
      headers['Authorization'] = auth;
    }
    let cookie = rawCookie;
    if (ck) {
      const c = this.driveTokens ? (this.driveTokens()[ck] || '') : '';
      if (c) {
        cookie = c;
      } else {
        // 网盘未绑定或授权失效 → 明确提示，前端据此引导重新扫码
        this.logger.w(`proxy /play: 网盘 provider=${ck} 未绑定或已失效`);
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('网盘未授权或授权已失效，请重新扫码');
        return;
      }
    }
    // ★ 2026-09-26：网盘会话 Cookie 合并 —— 上游（取流/清单）下发的 Set-Cookie 里有**刷新后的
    //   `__puus`**，必须与账号 cookie（`__pus` 等）一起用于后续分片；否则中途 401/403 断流
    //   （用户报「UC 没会员播放似乎要两个 cookie」）。本会话内按 provider 记忆合并结果。
    if (ck) cookie = this.applyPlayCookieJar(ck, cookie);
    if (cookie) headers['Cookie'] = cookie;
    // Preserve the browser UA for ordinary HLS links. Source-provided UA still
    // wins; this only replaces the relay's generic fallback for the manifest
    // and its rewritten child requests.
    if (!assetHint && (playlistHint || isHlsPlaylistUrl(target))) {
      const clientUa = req.headers['user-agent'];
      if (typeof clientUa === 'string' && clientUa.trim() && !headerValue(headers, 'user-agent')) {
        headers['User-Agent'] = clientUa;
      }
    }
    // ★ 转发客户端（<video>/HLS）发来的 Range 字节范围请求，让上游返回 206 分段；
    //   否则拿整段大文件 + 无 Content-Length 的 200，Chromium 播放器无法定位/拉流 → 永远"缓冲中"。
    const range = req.headers['range'];
    if (range) headers['Range'] = Array.isArray(range) ? range[0] : String(range);

    let resp = await this.openPlayStream(target, headers);
    let bufferedHead: Buffer = Buffer.alloc(0);
    // ★ 2026-09-28：网盘会话过期（UC 非会员尤甚）→ 上游 401/403 往往**同时下发刷新后的会话 Cookie**
    //   （`__puus`）。先把 Set-Cookie 记进会话 jar，再用刷新后的 Cookie 重试一次；仍失败才把失败透传。
    if (ck && (resp.status === 401 || resp.status === 403)) {
      this.rememberPlaySetCookies(ck, resp.headers);
      const retryCookie = this.applyPlayCookieJar(ck, cookie);
      if (retryCookie && retryCookie !== cookie) {
        try { await resp.body.dump(); } catch { /* 旧响应体丢弃失败无妨 */ }
        cookie = retryCookie;
        headers['Cookie'] = cookie;
        this.logger.w(`proxy /play: 上游 ${resp.status} → 用刷新后的会话 Cookie 重试一次（provider=${ck}）`);
        resp = await this.openPlayStream(target, headers);
      } else {
        this.logger.w(`proxy /play: 上游 ${resp.status} 且无可刷新的会话 Cookie（provider=${ck}，绑定可能已失效）`);
      }
    }
    // 百度 dlink 是短时签名地址。部分节点会在首次响应 403 时给出可诊断的
    // 31326/31045 文本；只记数字错误码，避免把“签名失效”和“账号失效”
    // 混成播放器统一的加载失败。只预读首块，不下载完整错误体或记录凭据。
    for (let attempt = 0; attempt < 2 && resp.status === 403 && isBaiduTarget(target); attempt++) {
      bufferedHead = await this.readHead(resp.body as unknown as NodeJS.ReadableStream, 256, () => true);
      const text = bufferedHead.subarray(0, 256).toString('utf8');
      const code = /(?:error_code|error_no|errno)["']?\s*[:=]\s*["']?(-?\d+)/i.exec(text)?.[1] || '-';
      const hitcode = /hitcode["']?\s*[:=]\s*["']?(\d+)/i.exec(text)?.[1] || '-';
      this.logger.w(`proxy /play: 百度 dlink 403 code=${code} hitcode=${hitcode} upstream=${redactUrl(resp.finalUrl)}`);
      // 真机验证：原 dlink 首次跳转的 CDN 偶发 31326/104，重新从 dlink
      // 获取跳转即可 206。只处理此错误一次，不改 UA/Range、不重转存，
      // 也不直接重试旧 CDN URL（其它账号/防盗链错误应原样返回）。
      let baiduCdn = false;
      baiduCdn = isBaiduCdn(resp.finalUrl);
      if (attempt !== 0 || code !== '31326' || hitcode !== '104' || !baiduCdn) break;
      resp.body.on('error', () => undefined);
      resp.body.destroy();
      this.logger.w('proxy /play: 百度 CDN 31326/104 → 从原 dlink 重新获取跳转一次');
      resp = await this.openPlayStream(target, headers);
      bufferedHead = Buffer.alloc(0);
    }
    // 上游 Set-Cookie（刷新后的 __puus 等）→ 记入本会话 cookie jar，供后续分片/清单请求使用
    if (ck) this.rememberPlaySetCookies(ck, resp.headers);
    // ★ 2026-09-28：每次回源的**结果落一行诊断**（播放失败率统计的第一手数据）
    logPlayDiag({
      kind: 'relay',
      stage: 'upstream',
      ok: resp.status < 400,
      status: resp.status,
      ck: ck || undefined,
      range: range ? String(range).slice(0, 32) : undefined,
      url: redactUrl(target),
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    const ct = safeResponseHeader('content-type', resp.headers['content-type']) || 'application/octet-stream';
    // ★ 2026-09-23 修复 py 源「视频无法播放」：清单判定不能只看 Content-Type，
    //   且**相对地址必须以「302 之后的最终地址」为基准**重写。
    //   实测（可可影视）：play URL 在 208.69.102.188:21302 → 302 到 142.248.97.185:11302；
    //   片段是相对地址（`xxx.ts?sign=…`）→ 老实现按**原始** target 拼 → 请求回到 208 主机，
    //   该主机对分片只回 3 字节 "OK\n"（防盗链哨兵）→ hls.js 拿到"3 字节分片"→ 永远播不出来。
    //   清单路径判断与播放器判型共用 isHlsPlaylistUrl，兼容无后缀但位于 /hls/ 的清单。
    let pathIsPlaylist = false;
    try {
      pathIsPlaylist = [target, resp.finalUrl].some(isHlsPlaylistUrl);
    } catch { /* 非法 URL 交给下游 */ }
    const isPlaylist = resp.status >= 200 && resp.status < 300 && !assetHint && (playlistHint || /mpegurl|m3u8/i.test(ct) || pathIsPlaylist);
    if (req.method === 'HEAD') {
      const responseHeaders: Record<string, string> = {
        'Content-Type': isPlaylist ? 'application/vnd.apple.mpegurl' : ct,
      };
      // 清单会被重写，不能把原清单长度当作本地响应长度；媒体长度/范围仍原样保留。
      if (!isPlaylist) for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = safeResponseHeader(name, resp.headers[name]);
        if (value !== undefined) responseHeaders[name] = value;
      }
      resp.body.on('error', () => undefined);
      resp.body.destroy();
      res.writeHead(resp.status, responseHeaders);
      res.end();
      return;
    }
    if (isPlaylist) {
      // m3u8 清单小，读全文后重写片段地址（每段都走 /play 带回 header/Cookie）
      const rawText = Buffer.from(await resp.body.arrayBuffer()).toString('utf-8');
      const base = resp.finalUrl || target; // ★ 302/重定向后的真实地址
      // ★ 2026-09-29 m3u8 去广告（TVBox M3u8.purify 移植；默认关，见 player-settings.json）
      //   口径照抄 TVBox VodController.java:1962-1974：只对**点播**清单（含 ENDLIST）做，
      //   且只有确实删到段（removed > 0）才替换播放列表 —— 否则一律回原文。
      let text = rawText;
      if (this.purify?.enabled()) {
        try {
          const p = purifyVodM3u8(rawText, base, this.purify.rulesFor(base), (m) => this.logger.i(`proxy /play: ${m}`));
          if (p && p.removed > 0) {
            text = p.text;
            this.logger.i(`proxy /play: m3u8 去广告移除 ${p.removed}/${p.total} 段（${redactUrl(base)}）`);
          }
        } catch (e) {
          // 清洗失败绝不影响播放：回原文
          this.logger.w(`proxy /play: m3u8 去广告异常，已回原文：${(e as Error).message}`);
        }
      }
      const body = rewriteM3u8WithHeaders(Buffer.from(text, 'utf-8'), base, headers, proxyBase);
      res.writeHead(resp.status, { 'Content-Type': /mpegurl|m3u8/i.test(ct) ? ct : 'application/vnd.apple.mpegurl' });
      res.end(body);
      return;
    }
    // ★ 真实网速：统计本 /play 实际写回播放器的字节（透传 + 聚合两路都涵盖），
    //   经 onSpeed 推送渲染层 —— 比渲染层 Resource Timing 可靠（媒体 timing 常拿不到字节）。
    const out = { bytes: 0, prev: 0, prevT: 0 };
    let speedTimer: ReturnType<typeof setInterval> | null = null;
    const origWrite = res.write.bind(res);
    // 包装 write 累计字节（透传/聚合都经此写回播放器；chunk 为 string|Buffer）
    type WriteFn = typeof res.write;
    (res as unknown as { write: WriteFn }).write = ((chunk: unknown, ...rest: unknown[]) => {
      try { if (chunk) out.bytes += Buffer.byteLength(chunk as Buffer | string); } catch { /* ignore */ }
      return origWrite(chunk as never, ...(rest as never[]));
    }) as WriteFn;
    const stopSpeed = () => { if (speedTimer) { clearInterval(speedTimer); speedTimer = null; } };
    res.once('close', stopSpeed);
    res.once('finish', stopSpeed);
    if (this.onSpeed) {
      speedTimer = setInterval(() => {
        const now = Date.now();
        const dt = (now - out.prevT) / 1000;
        if (out.prevT > 0 && dt > 0) {
          const kbs = (out.bytes - out.prev) / 1024 / dt;
          if (kbs > 0) this.onSpeed?.(kbs);
        }
        out.prev = out.bytes;
        out.prevT = now;
      }, 600);
    }
    // ★ 并发回源聚合（对齐影视仓多段并发，绕开关卡单连接限速）：
    //   夸克对"单条上游连接"限速（实测约 1.1MB/s），但允许多连接并发叠加（8 并发约 3.7MB/s）。
    //   这里把播放器发来的一个 Range 拆成多个并发的子 Range 回源夸克（每个子请求一条独立连接），
    //   再按偏移顺序拼装回写 —— 对播放器完全透明（仍见到单条 206/200 流），seek 照常。
    //   ⚠️ 夸克直链按节点分流（release65 实测定论，release75 曾破坏 → 已回归）：
    //     · **普通节点(dl-pc-zb)**：支持标准 206 + Content-Range，并发聚合拼装可靠 → **允许聚合提速**。
    //     · **加速节点(dl-c-zb 等，需 acquire_dl_token)**：**禁聚合、单连接透传** —— 并发子 Range
    //       会被节点忽略导致坏流（release65），且额外的 Range 预检会消费 auth_key → 播不出（release75 教训）。
    //     · 其余源（其它网盘/普通源）：保留聚合，不误伤。
    const isQuarkAccelNode = /[.-]dl-c-zb/i.test(target);
    // 百度 dlink 带有短时签名与节点状态：把浏览器的 `bytes=0-` 拆成多个并发
    // 子 Range 会让部分 pcs 节点把后续请求判为重复/失效，表现为首个 206
    // 之后 other side closed 或 403。真实小 Range 探针不会触发此分支，
    // 因此这里必须按 provider 禁用聚合，保留单连接和原始签名。
    const isBaiduDirect = isBaiduTarget(target);
    const rng = range === undefined ? '' : Array.isArray(range) ? range[0] : String(range);
    // ★★ 2026-10-08（用户报「橘汁4K · jd4k 点开就提示已播放完毕」根因修复）★★
    //   图片伪装分片剥离：仅对「整段起始」请求（无 Range 或 `bytes=0-`）嗅探响应头 ≤128KB；
    //   命中 [JPEG/PNG 图片][TS 载荷] → 只把 TS 部分回给播放器（否则 ffmpeg 按图片解析、
    //   读包失败 → mpv 当 EOF → 「已播放完毕」假象；识别口径见 imagePreludeLen）。
    //   非伪装响应：保留已消费字节，透传时先写预读头部再接剩余流。
    //   ★ 带偏移的 Range 请求不嗅探（HLS 拖动 = 重开分片，实测 mpv/ffmpeg 均从 0 开始取）。
    if (resp.status < 400 && resp.body && (rng === '' || parseByteRange(rng)?.start === 0)) {
      const head = await this.readHead(resp.body as unknown as NodeJS.ReadableStream, DETECT_HEAD_LEN, (b) => {
        if (b.length >= 2 && !((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0x52 && b[1] === 0x49))) return true;
        return imagePreludeLen(b) > 0; // 图片结束且 TS 对齐即停
      });
      const pre = head.length ? imagePreludeLen(head) : 0;
      if (pre > 0) {
        const lenHeader = resp.headers['content-length'];
        const total = lenHeader === undefined ? NaN : parseInt(String(lenHeader), 10);
        const newLen = Number.isFinite(total) ? Math.max(0, total - pre) : NaN;
        const stripHdr: Record<string, string> = { 'Content-Type': 'video/mp2t', 'Accept-Ranges': 'bytes' };
        if (Number.isFinite(newLen)) {
          stripHdr['Content-Length'] = String(newLen);
          if (resp.status === 206) stripHdr['Content-Range'] = `bytes 0-${Math.max(0, newLen - 1)}/${newLen}`;
        }
        res.writeHead(Number.isFinite(newLen) ? resp.status : 200, stripHdr);
        const rest = head.subarray(pre);
        if (rest.length) res.write(rest);
        const upstream = resp.body as unknown as NodeJS.ReadableStream;
        // 客户端 seek 中止（AbortError）属预期，静默；其余交给管道自然结束
        upstream.on('error', () => { /* ignore */ });
        if ((upstream as { readableEnded?: boolean }).readableEnded) res.end();
        else (upstream as unknown as { pipe(dest: ServerResponse): unknown }).pipe(res);
        // 与常规透传同款收尾：客户端断开（seek 关旧连接）→ 立即 destroy 上游，不留悬挂流
        req.on('close', () => {
          if (!res.writableEnded) {
            try { res.destroy(); } catch { /* ignore */ }
            (upstream as { destroy?: () => void }).destroy?.();
          }
        });
        this.logger.i(`proxy /play: 已剥离图片伪装前导 ${pre} 字节 → TS（${redactUrl(target)}）`);
        return;
      }
      // 短响应可能在预读后已经 end/destroy，此时 unshift 会丢失字节甚至挂起。
      // 保留已消费的头部，透传时先写它，再 pipe 剩余流（不重复回源）。
      bufferedHead = head;
    }
    const canAggregate =
      !!rng &&
      resp.status === 206 &&
      partialRangeTotal(resp.headers) !== null &&
      !isQuarkAccelNode &&
      !isBaiduDirect; // 加速节点与百度签名直链恒单连接
    if (canAggregate) {
      const handled = await this.aggregateStream.tryHandle(target, headers, rng, resp, res);
      if (handled) {
        // 上游已在本方法内取消/复用（避免双读），返回
        (resp.body as unknown as { cancel?: () => Promise<void> }).cancel?.().catch(() => { /* ignore */ });
        return;
      }
      // ★ 2026-09-28：聚合**没能接管**时必须留痕 —— 旧实现静默降级成单连接，
      //   表现是「能播但极慢/偶发卡顿」，却查不到原因（用户第 6 项的一部分症状）。
      this.logger.w(`proxy /play: Range 聚合未接管，降级为单连接透传（status=${resp.status} range=${rng}）`);
      logPlayDiag({ kind: 'relay', stage: 'aggregate-failed', ok: false, status: resp.status, range: rng, url: redactUrl(target) });
    }
    // 媒体/其它 → 流式透传：原样转发上游状态码与关键响应头（Content-Length/Content-Range/Accept-Ranges），边收边发给播放器
    const fwd: Record<string, string | string[]> = { 'Content-Type': ct };
    for (const h of ['content-length', 'content-range', 'accept-ranges', 'content-disposition', 'last-modified', 'etag', 'cache-control', 'content-encoding']) {
      const v = resp.headers[h];
      // 百度 dlink 的 Content-Disposition 常含 UTF-8 文件名字节；Node 在存在
      // Content-Length 时还会把它按 Latin-1 转成 Buffer 再校验，直接透传会抛出
      // `Invalid character in header content`，导致已经拿到 206 的媒体连接被中断。
      // 这类展示性 header 对播放不是必需的，非法值直接丢弃；长度/范围等合法
      // header 仍然完整透传。
      const value = safeResponseHeader(h, v);
      if (value !== undefined) fwd[h] = value;
    }
    res.writeHead(resp.status, fwd);
    // resp.body 是 Node 可读流（undici BodyReadable），直接管道转发 → 边收边发给播放器
    const upstream = resp.body as unknown as NodeJS.ReadableStream;
    // ★ 快进/拖动进度条会让 <video> 关闭旧的 /play 连接 → 我们 destroy 上游 undici 流；
    //   未挂 'error' 监听时，销毁 in-flight 流会把 AbortError 冒泡成主进程"未捕获异常"弹窗。
    //   这里吞掉（seek 中止属预期行为），仅非 AbortError 才记日志。
    upstream.on('error', (e: unknown) => {
      if (!(e instanceof Error) || e.name !== 'AbortError') {
        this.logger.e('proxy /play 上游流错误', e);
        logPlayDiag({
          kind: 'relay',
          stage: 'stream-error',
          ok: false,
          status: resp.status,
          range: rng || undefined,
          url: redactUrl(target),
          reason: String((e as Error)?.message ?? e).slice(0, 160),
        });
      }
      (upstream as { destroy?: () => void }).destroy?.();
    });
    if (bufferedHead.length) res.write(bufferedHead);
    if ((upstream as { readableEnded?: boolean }).readableEnded) res.end();
    else (upstream as unknown as { pipe(dest: ServerResponse): unknown }).pipe(res);
    res.on('error', (e: unknown) => {
      // 客户端断开(seek)时 res 也可能抛 AbortError/EPIPE，一并吞掉避免冒泡
      if (!(e instanceof Error) || e.name !== 'AbortError') this.logger.e('proxy /play 响应流错误', e);
    });
    res.on('close', () => {
      if (!res.writableEnded) {
        (upstream as { destroy?: () => void }).destroy?.();
      }
    });
  }

  /** 百度播放器读取 MP4 尾部索引/seek 时复用已成功的 CDN，避免每个 Range 重新跳转到拒绝访问节点。 */
  private async openPlayStream(target: string, headers: Record<string, string>) {
    if (!isBaiduTarget(target)) return this.upstream.openStream(target, headers);
    const authHeaders = Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'range')
      .map(([name, value]) => [name.toLowerCase(), value]).sort(([a], [b]) => a.localeCompare(b));
    const key = createHash('sha256').update(JSON.stringify([target, authHeaders])).digest('hex');
    const now = Date.now();
    for (const [k, value] of this.baiduPlayNodes) if (value.expires <= now) this.baiduPlayNodes.delete(k);
    const cached = this.baiduPlayNodes.get(key);
    let resp: Awaited<ReturnType<UpstreamHttpClient['openStream']>> | undefined;
    if (cached) {
      try { resp = await this.upstream.openStream(cached.url, headers); }
      catch { this.baiduPlayNodes.delete(key); }
      if (resp && [401, 403, 404, 410].includes(resp.status)) {
        resp.body.on('error', () => undefined);
        resp.body.destroy();
        this.baiduPlayNodes.delete(key);
        resp = undefined;
      }
    }
    resp ??= await this.upstream.openStream(target, headers);
    if ((resp.status === 200 || resp.status === 206) && isBaiduCdn(resp.finalUrl)) {
      if (!this.baiduPlayNodes.has(key) && this.baiduPlayNodes.size >= 32) {
        this.baiduPlayNodes.delete(this.baiduPlayNodes.keys().next().value!);
      }
      // 缓存命中不延长签名有效期。
      this.baiduPlayNodes.set(key, { url: resp.finalUrl, expires: cached && this.baiduPlayNodes.has(key) ? cached.expires : now + 5 * 60_000 });
    }
    return resp;
  }

  /**
   * ★ 2026-10-08（jpg 伪装分片剥离配套）：从上游流预读 ≤n 字节头部后**暂停**流。
   *   - `stop(head)` 返回 true 即提前结束（普通流读到首块就停，不拖慢起播）；
   *   - 8s 兜底超时（流卡住时不再等，按已读内容继续）；
   *   - 调用方负责后续：命中伪装 → 丢弃前导；未命中 → 先写 head，再 pipe 剩余（已 end 则直接结束响应）。
   */
  private readHead(stream: NodeJS.ReadableStream, n: number, stop: (head: Buffer) => boolean): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      let done = false;
      const chunks: Buffer[] = [];
      let got = 0;
      const timer = setTimeout(finish, 8000);
      function cleanup(): void {
        clearTimeout(timer);
        stream.removeListener('data', onData as never);
        stream.removeListener('end', finish as never);
        stream.removeListener('error', onError as never);
        try { (stream as unknown as { pause?: () => void }).pause?.(); } catch { /* ignore */ }
      }
      function finish(): void {
        if (done) return;
        done = true;
        cleanup();
        resolve(Buffer.concat(chunks));
      }
      function onError(error: Error): void {
        if (done) return;
        done = true;
        cleanup();
        reject(error); // 不能把上游失败当 EOF 后继续 pipe 已销毁流，否则播放器会一直等待。
      }
      function onData(c: Buffer | string): void {
        const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
        chunks.push(b);
        got += b.length;
        if (got >= n || (stop && stop(Buffer.concat(chunks)))) finish();
      }
      stream.on('data', onData as never);
      stream.once('end', finish as never);
      stream.once('error', onError as never);
    });
  }

}

/** 只转发 Node 能安全写出的 HTTP header；不把文件名等展示信息当作播放必要条件。 */
export function safeResponseHeader(name: string, raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  // 该展示头不是播放必要条件。只保留 ASCII（含 RFC5987 编码文件名），
  // 同时规避 Node 对 Content-Disposition 的特殊 Buffer 转换行为。
  if (name === 'content-disposition' && [...value].some((character) => character.charCodeAt(0) > 0x7f)) return undefined;
  try {
    validateHeaderValue(name, value);
    return value;
  } catch {
    return undefined;
  }
}

function isBaiduTarget(target: string): boolean {
  try { return /(?:^|\.)pcs\.baidu\.com$/i.test(new URL(target).hostname); }
  catch { return false; }
}

function isBaiduCdn(target: string): boolean {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' && /(?:^|\.)baidupcs\.com$/i.test(url.hostname);
  } catch { return false; }
}

