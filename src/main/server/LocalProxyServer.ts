// src/main/server/LocalProxyServer.ts
// ★ 127.0.0.1:9978 本地代理 —— 与安卓同端口同路由。
// 路由 /proxy?do=live&type=txt&ext=<base64urlsafe> —— 解 ext 得真实订阅 URL，抓取返回原文（让 lives 归一化可 1:1 复刻）。
// 路由 /play?url=<encoded>&ua=<encoded>&referer=<encoded> —— header 注入中继（v1 简单透传，带自定义 header）。
// 路由 /file/<path> —— 等效安卓 TVBox 的 Local 蜘蛛：按路径提供本地文件。
//   ★ 部分 jar 蜘蛛的 ext 直接写成 `http://127.0.0.1:9978/file/<子路径>`（如
//     KungFu404 的 token 文件、PushAgent 系蜘蛛推送的图片）；安卓侧由内置
//     Local 蜘蛛从 assets/数据目录读出。桌面版必须实现同名路由，否则这些蜘蛛
//     拿到 404 → 初始化失败 → 分类/首页空白。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as undiciRequest, Agent } from 'undici';
import { decodeUrlSafe } from '../../engine/util/base64';
import type { Logger } from '../../shared/types';
import { HttpRequestError } from '../../shared/HttpRequestError';
import { LOCAL_PROXY_BASE, LOCAL_PROXY_PORT } from '../../shared/constants';
import { userDataDir, cacheDir } from '../util/paths';
import { logPlayDiag, redactUrl } from '../util/playDiag';
import { createDohAgent } from '../net/DnsResolver';
import { dispatchChain } from '../net/proxy';
import { HtmlMedia } from '../player/HtmlMedia';
import { RangeAggregateStream } from './RangeAggregateStream';
import { LocalFileRoutes } from './LocalFileRoutes';
import { ImageProxyService } from './ImageProxyService';
import { BtMediaProxy, type BtStreamAccess } from './BtMediaProxy';
import { UpstreamHttpClient } from './UpstreamHttpClient';
export type { BtStreamAccess } from './BtMediaProxy';
export { resolveLocalFilePath } from './LocalFileAccess';
export { buildSlices, imagePreludeLen, isTsAligned, jpegPreludeLen, parseByteRange } from './mediaTransforms';
export { decodeProxyHeaders, rewriteM3u8, rewriteM3u8WithHeaders, rewriteUriAttrs } from './hlsProxyTransforms';
import { PlaybackRelayService, safeResponseHeader } from './PlaybackRelayService';
import { RemoteControlRoutes, type RemotePushAction } from './RemoteControlRoutes';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
export type { RemotePushAction } from './RemoteControlRoutes';

const agent = new Agent({ connect: { timeout: 30000 } });
/** 出图中继专用（TMDB 图床经 DoH 可达；渲染层直连可能被 DNS 污染 → 图裂） */
const imgAgent = createDohAgent();

/**
 * ★ 2026-09-25：出站 dispatcher 链 —— 用户设的**网络代理**（非本机目标）优先，其次 DoH，最后直连。
 * `/img`（封面）与 `/play`（取流）的源站请求都走这里，保证被 DNS 污染 / TLS SNI 阻断的站点在代理下可用。
 */
function outboundDispatchers(targetUrl: string): Array<Agent | import('undici').ProxyAgent> {
  return dispatchChain(targetUrl, imgAgent, agent);
}

// ★★ 2026-09-19 回归 release65 定论：**加速节点（dl-c-zb 等）禁聚合、单连接透传**。
//   release75 曾在加速节点加「Range 预检 + 3 并发聚合」：预检会额外消费一次 auth_key 直链请求
//   （夸克 download_url 的 token 绑定会话，多打一次 Range 会被 CDN 拒绝后续请求 → 直接无法播放），
//   且加速节点不理会并发子 Range（release65 已实测坏流）→ 播放反向劣化"出现快反而播不出"。
//   加速节点本身单连接吞吐 ≈1.4MB/s，普通直连已可播；不再预检、不再聚合。
//   普通节点（dl-pc-zb 及非夸克源）保留 8 并发聚合（release65 验证：标准 206 + Content-Range，可靠提速）。

export class LocalProxyServer {
  private htmlMedia: HtmlMedia;
  private localFiles: LocalFileRoutes;
  private server?: ReturnType<typeof createServer>;
  /** 实时网速回调（KB/s）：主进程注入后即可把真实转发字节推给渲染层显示 */
  onSpeed?: (kbs: number) => void;
  /**
   * ★ 2026-09-26：蜘蛛 JVM 内宿主代理被访问的回调（主进程注入 → 把该 JVM「钉住」）。
   *   壳/蜘蛛的 `<entry>?do=proxy&key=…` 播放地址指向本机 9978 的 `/proxy/<jvmPort>`，
   *   key 只有那个 JVM 能解，所以这里要做一次本机转发；转发的同时通知池别回收它，否则播放中段断流。
   */
  onSpiderProxy?: (port: number) => void;
  onPythonProxy?: (key: string, params: Record<string, string>) => Promise<unknown[]>;
  /** ★ 2026-09-29：BT 取流口（磁力 B；main/index.ts 注入 TorrentPlay；未注入 = /bt 一律 404） */
  bt?: BtStreamAccess;
  /**
   * ★ 2026-09-29 本地包：包下标 → 包根绝对路径（main/index.ts 注入 LocalPkgStore.rootOf）。
   * `/pkg/<i>/<rel>` 供三处使用：① 订阅里展开出的相对引用（jar 的 OkHttp、drpy 的相对 require、
   * spider 的 ext 配置）；② py 之外的一切包内资源；③ 网页源（html）与它的相对资源。
   * 未注入 = /pkg 一律 404（旧行为）。
   */
  pkgRoot?: (index: number) => string | null;
  /**
   * ★ 2026-09-26：网盘播放会话 Cookie jar（provider → 上游下发的 `k=v` 键值行）。
   *   上游直链/清单响应会刷新 `__puus` 等会话 cookie，必须与账号 cookie 一起用；
   *   否则分片请求仍带旧值 → 中途 401/403 断流（用户报「UC 没会员播放要两个 cookie」）。
   *   仅内存态（一次播放会话内有效），上限 20 条防无限增长。
   */
  /** ★ 2026-10-25（局域网 Web 控制台与手机推送）：处理手机推送指令 */
  onRemoteAction?: (action: RemotePushAction) => Promise<void> | void;
  remoteControl: RemoteControlRoutes;
  private aggregateStream: RangeAggregateStream;
  private imageProxy: ImageProxyService;
  private btMediaProxy: BtMediaProxy;
  private upstream: UpstreamHttpClient;
  private playback!: PlaybackRelayService;
  /** ★ 2026-10-16：已 stop（退出中）—— 用于让「端口重试链」立刻停摆 */
  private stopped = false;

  constructor(
    private logger: Logger,
    private driveTokens?: () => Record<string, string>,
    /**
     * ★ 2026-09-29：m3u8 去广告注入（对位 TVBox `HawkConfig.M3U8_PURIFY`，默认关）。
     *   · `enabled()` —— 配置页开关（<userData>/player-settings.json），每轮清单回源时读一次 → 改后即时生效；
     *   · `rulesFor(url)` —— 该播放地址所属 host 的订阅 `rules[].regex`（`hostRegexFor` 的产物）。
     *   不注入 = 彻底不做去广告（旧行为）。
     */
    private purify?: { enabled: () => boolean; rulesFor: (url: string) => string[] },
    /**
     * ★ 2026-09-29 WebDAV 取流认证：`/play?...&dav=<serverId>` → 该服务器的 `Authorization` 头值。
     *   凭据只存在主进程加密存储里，**绝不进 URL**；不注入 = 不做 WebDAV 认证（旧行为）。
     */
    private davAuth?: (id: string) => string,
  ) {
    this.htmlMedia = new HtmlMedia(logger);
    this.localFiles = new LocalFileRoutes({
      roots: () => [userDataDir(), cacheDir()],
      packageRoot: (index) => this.pkgRoot?.(index) ?? null,
      logger,
    });
    this.aggregateStream = new RangeAggregateStream({
      fetchRange: async (target, headers) => {
        const response = await this.upstream.openStream(target, headers);
        return Buffer.from(await (response.body as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer());
      },
      diagnose: (event) => logPlayDiag({
        kind: 'relay',
        stage: 'aggregate-skip',
        reason: event.reason,
        total: event.total,
        url: redactUrl(event.url),
      }),
      warn: (message) => this.logger.w(message),
      error: (message, cause) => this.logger.e(message, cause),
    });
    this.imageProxy = new ImageProxyService({
      dispatchers: (target, domesticPoster) => domesticPoster ? dispatchChain(target, agent, imgAgent) : outboundDispatchers(target),
      request: (target, options) => undiciRequest(target, options),
    });
    this.btMediaProxy = new BtMediaProxy({
      access: () => this.bt,
      logger: this.logger,
      speedReportingEnabled: () => !!this.onSpeed,
      reportSpeed: (kbs) => this.onSpeed?.(kbs),
    });
    this.upstream = new UpstreamHttpClient({
      dispatchers: outboundDispatchers,
      request: (url, options) => undiciRequest(url, options),
    });    this.playback = new PlaybackRelayService({
      logger,
      driveTokens,
      purify,
      davAuth,
      aggregateStream: this.aggregateStream,
      upstream: this.upstream,
      proxyBase: () => {
        const address = this.server?.address();
        return address && typeof address !== 'string' ? 'http://127.0.0.1:' + address.port : LOCAL_PROXY_BASE;
      },
      speedReporter: () => this.onSpeed,
    });
    this.remoteControl = new RemoteControlRoutes({
      assetsDir: () => {
        try {
          const devDir = join(process.cwd(), 'resources', 'web', 'remote-push');
          if (existsSync(devDir)) return devDir;
          return join(userDataDir(), '..', 'resources', 'web', 'remote-push');
        } catch {
          return join(process.cwd(), 'resources', 'web', 'remote-push');
        }
      },
      logger: this.logger,
      onAction: (action) => this.onRemoteAction?.(action),
    });
  }

  /** 把 jar 里记下的 Set-Cookie 键值合并进本次请求的 Cookie（无记录则原样返回） */
  /**
   * ★ 2026-09-26：`/proxy/<jvmPort>?do=proxy&key=…` → 蜘蛛 JVM 内的宿主代理。
   *   key→真实 url/headers 的静态表在**那个 JVM** 里，只有它能解；本机转发 + 顺带钉住该进程。
   *   本机目标一律直连（绝不走用户代理/DoH）。
   */
  start(port: number = LOCAL_PROXY_PORT, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve) => {
      // ★★ 2026-10-16（用户报「卸载重装后打开会闪退，排查指向 9978 被占用」）★★
      //   实测用户日志：出现过两次 `EADDRINUSE 127.0.0.1:9978`，且那次会话**整场本地中继失效**
      //   （直播归一化 / `/play` / `/img` 全废）。成因 = **另一个实例还活着占着 9978**
      //   （本机实测 TIME_WAIT 不挡重新绑定 —— 第 1 次重绑即成功，故只可能是活进程）。
      //   旧行为：监听失败就当场降级 + 只记一条日志，之后再没人去抢端口 → 整场不可用。
      //   现行为：**后台静默重试**（每 2s × 15 ≈ 30s），等对方退干净后中继自愈；
      //   首次失败仍**立即放行启动**（不拖慢开窗），成功后日志会写明「第 N 次尝试成功」。
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      let tries = 0;
      const RETRY_MAX = 15;
      const RETRY_DELAY = 2000;
      const attempt = (): void => {
        if (this.stopped) { done(); return; }
        const first = tries === 0;
        this.server = createServer((req, res) => this.handle(req, res));
        this.server.on('error', (e) => {
          try { this.server?.close(); } catch { /* ignore */ }
          tries += 1;
          const code = (e as NodeJS.ErrnoException).code;
          if (code === 'EADDRINUSE' && tries <= RETRY_MAX && !this.stopped) {
            this.logger.w(`proxy: ${host}:${port} 被占用（多半是上一个实例还没退干净 / 仍在运行）→ 第 ${tries} 次重试将在 ${RETRY_DELAY}ms 后开始`);
            if (first) done(); // ★ 只有首次放行启动；后续重试不再影响启动流程
            setTimeout(attempt, RETRY_DELAY).unref?.();
            return;
          }
          // 端口被非 EADDRINUSE（或重试耗尽）→ 沿用既有降级：本地中继不可用，但绝不阻塞启动
          this.logger.e(`proxy 监听失败（${host}:${port} 端口占用？本地中继不可用：直播归一化 / /play / /img 会失效）`, e);
          done();
        });
        this.server.listen(port, host, () => {
          this.logger.i(`proxy: 监听 ${host}:${port}${tries ? `（第 ${tries + 1} 次尝试成功）` : ''}`);
          done();
        });
      };
      attempt();
    });
  }

  stop(): void {
    // ★ 2026-10-16：置位后，重试链立刻停摆（避免「已退出却在后台又抢回 9978」）
    this.stopped = true;
    this.htmlMedia.stop();
    this.playback.stop();
    this.server?.close();
  }

  private async spiderJvmProxy(u: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 分享会话只能由主进程直连所属 JVM 读取，不能从带 CORS 的媒体中继公开。
    if (u.searchParams.get('do') === 'winbox-baidu-context') {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('not found');
      return;
    }
    const port = Number(u.pathname.slice('/proxy/'.length));
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad jvm proxy port');
      return;
    }
    try {
      this.onSpiderProxy?.(port);
    } catch {
      /* 钉住失败不影响转发 */
    }
    const target = `http://127.0.0.1:${port}/proxy${u.search}`;
    try {
      // ★ 2026-10-09：转发 Range（拉流 seek 必需）——此前一个头都不带，jar 自解链（do=pan）会整段 200。
      const fwdHeaders: Record<string, string> = {};
      for (const h of ['range', 'accept']) {
        const v = req.headers[h];
        if (typeof v === 'string') fwdHeaders[h] = v;
      }
      const up = await undiciRequest(target, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        dispatcher: agent,
        headersTimeout: 30000,
        bodyTimeout: 0, // 媒体流可能很长：不做 body 超时
        headers: fwdHeaders,
      });
      const outHeaders: Record<string, string> = {};
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = up.headers[k];
        if (typeof v === 'string') outHeaders[k.replace(/(^|-)([a-z])/g, (_m, a, b) => a + b.toUpperCase())] = v;
      }
      outHeaders['Access-Control-Allow-Origin'] = '*';
      // ★ 2026-10-09：自解链排障 —— 非 2xx/206 或非媒体 Content-Type 时记一行（含正文前 160 字节预览）。
      //   第五轮实证「转发通了但 mpv Failed to open」时完全无线索；正文预览能直接看到 Pan.proxy 的报错串。
      const ct = String(up.headers['content-type'] || '');
      const statusOk = up.statusCode >= 200 && up.statusCode <= 299;
      const mediaish = /video|audio|octet-stream|mpegurl|mp2t/i.test(ct);
      if (!statusOk || (!mediaish && up.statusCode !== 304)) {
        let preview = '';
        if (!req.method || req.method.toUpperCase() !== 'HEAD') {
          try {
            const it = up.body[Symbol.asyncIterator]();
            const first = await it.next();
            if (!first.done && first.value) {
              const buf = Buffer.from(first.value as Buffer);
              preview = buf.subarray(0, 160).toString('utf8').replace(/\s+/g, ' ');
              // 已消费的首块仍是有效媒体数据 → 塞回去继续转发
              const rest = (async function* gen(): AsyncGenerator<Buffer> {
                yield buf;
                for await (const c of up.body) yield c as Buffer;
              })();
              res.writeHead(up.statusCode, outHeaders);
              for await (const c of rest) res.write(c);
              res.end();
              this.logger.w(
                `proxy: 自解链响应异常 status=${up.statusCode} ct=${ct} body=${preview} → ${u.search.slice(0, 120)}`,
              );
              return;
            }
          } catch {
            /* 读不到首块按原样走 */
          }
        }
        this.logger.w(`proxy: 自解链响应异常 status=${up.statusCode} ct=${ct} → ${u.search.slice(0, 120)}`);
      }
      res.writeHead(up.statusCode, outHeaders);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      for await (const chunk of up.body) res.write(chunk as Buffer);
      res.end();
    } catch (e) {
      this.logger.w(`proxy: 蜘蛛 JVM 本地代理不可达（127.0.0.1:${port}）：${(e as Error).message}`);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('spider jvm proxy unreachable');
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const u = new URL(req.url || '', `http://127.0.0.1:${LOCAL_PROXY_PORT}`);
      if ((u.pathname === '/proxy' || u.pathname === '/') && u.searchParams.get('do') === 'py') {
        if (!this.onPythonProxy) throw new Error('Python 代理未就绪');
        const params = Object.fromEntries(u.searchParams);
        if (req.headers.range) params.Range = String(req.headers.range);
        const result = await this.onPythonProxy(params.key || '', params);
        const status = Number(result[0]);
        if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('Python 代理状态无效');
        const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Content-Type': safeResponseHeader('content-type', String(result[1] || 'application/octet-stream')) || 'application/octet-stream' };
        if (result[3] && typeof result[3] === 'object') for (const [name, value] of Object.entries(result[3])) {
          const safe = safeResponseHeader(name, value);
          if (safe && !/^(connection|transfer-encoding|content-length)$/i.test(name)) headers[name] = safe;
        }
        const body = result[2] as { base64?: string } | string;
        res.writeHead(status, headers);
        res.end(typeof body === 'object' && body?.base64 ? Buffer.from(body.base64, 'base64') : String(body || ''));
        return;
      }
      if (u.pathname.startsWith('/html/')) return await this.htmlMedia.handle(u, req, res);
      if (u.pathname.startsWith('/proxy/')) {
        return await this.spiderJvmProxy(u, req, res);
      }
      if (u.pathname === '/proxy' && u.searchParams.get('do') === 'live') {
        return await this.liveProxy(u, req, res);
      }
      // TVBox/CatVod 的点播清单中继：`do=m3u8&url=...&headers=...`。
      // 缓存 JAR 的 DC.B：URL 经 URLEncoder，headers 是 Base64(NO_WRAP)
      // 编码的 `URLEncoder(name):URLEncoder(value);...`，不是 JSON。
      if (u.pathname === '/proxy' && ['m3u8', 'Adm3u8'].includes(u.searchParams.get('do') || '')) {
        return await this.playback.handleM3u8(u, req, res);
      }
      // ★ 2026-10-09：jar 的 `spider.Proxy.a()` 会探 9978~9999 的 `/proxy?do=ck`（应答体 == "ok" 才采用）。
      //   应答 ok 后 jar 把 `http://127.0.0.1:9978/proxy?do=pan&…` 当播放地址 —— playInner 再改写成
      //   `/proxy/<jvmPort>` 进该源蜘蛛 JVM 自解链（桌面端原生通道解不了的「分享内 fs_id」只有 jar 能解）。
      if (u.pathname === '/proxy' && u.searchParams.get('do') === 'ck') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end('ok');
        return;
      }
      if (u.pathname === '/play' || u.pathname === '/play/segment.ts') {
        return await this.playback.handlePlay(u, req, res);
      }
      if (u.pathname === '/img') {
        return await this.imageProxy.handle(u, res);
      }
      if (u.pathname.startsWith('/file/')) {
        return this.localFiles.file(u, res);
      }
      // ★ 2026-09-29 本地包：包内资源（订阅相对引用 / 网页源 html 及其相对资源 / jar / xbpq 配置）
      if (u.pathname.startsWith('/pkg/')) {
        return this.localFiles.packageFile(u, res);
      }
      if (u.pathname.startsWith('/bt/')) {
        return await this.btMediaProxy.handle(u, req, res);
      }
      if (this.remoteControl.matches(u.pathname)) {
        return await this.remoteControl.handle(u, req, res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (e) {
      this.logger.e('proxy handle error', e);
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpRequestError) {
        res.writeHead(e.code === 'HTTP_TOTAL_TIMEOUT' ? 504 : 502, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Winbox-Error-Code': e.code,
        });
        res.end(e.message);
        return;
      }
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('proxy error');
    }
  }

  /** do=live：ext 是 base64urlsafe 的真实订阅 URL，抓取后原样返回 */
  private async liveProxy(u: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ext = u.searchParams.get('ext') || '';
    if (!ext) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('missing ext'); return;
    }
    let targetUrl = ext;
    if (!/^https?:\/\//.test(ext)) {
      try { targetUrl = decodeUrlSafe(ext); } catch { /* 当原串 */ }
    }
    const controller = new AbortController();
    const abortOnClose = (): void => {
      if (!res.writableEnded) controller.abort(new HttpRequestError('HTTP_CANCELLED', '客户端已关闭连接'));
    };
    res.once('close', abortOnClose);
    req.once('aborted', abortOnClose);
    try {
      const buf = await this.upstream.fetchWithRedirect(targetUrl, {}, { signal: controller.signal });
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(buf.status, { 'Content-Type': buf.contentType || 'text/plain; charset=utf-8' });
      res.end(buf.body);
    } finally {
      res.removeListener('close', abortOnClose);
      req.removeListener('aborted', abortOnClose);
    }
  }

  /**
   * CatVod m3u8 兼容入口；直接复用 /play 的诊断、请求头、清单重写和流式转发。
   */


}

/** 带 URI 属性的 HLS 标签（密钥/初始化段/子清单/备用音轨/低延迟分片…） */
