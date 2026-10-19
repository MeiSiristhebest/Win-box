// src/main/update/UpdateService.ts
// ★ 2026-09-29：启动更新检查（主进程侧）—— 查 GitHub 最新 Release → 版本比对 → 代理加速下载
//   Setup 安装包（带进度）→ 拉起安装程序。
//
// 依赖：undici（与全项目出站口径一致，走 `dispatchChain` 复用用户的网络代理设置）。
// 红线：**检查失败不得锁死软件**（check() 返回 updateAvailable=false）；下载只会从
//   `cacheDir()/update/` 落盘（应用私有目录，不与 Chromium 缓存冲突）。
import { Agent, request } from 'undici';
import { app, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCEL_FINALISTS,
  ACCEL_PROBE_BYTES,
  ACCEL_PROBE_CONCURRENCY,
  ACCEL_PROBE_LIMIT,
  ACCEL_PROBE_MS,
  UPDATE_RELEASES_API,
  trustedUpdateAsset,
  isUpdateAvailable,
  parseLatestRelease,
  pickSetupAsset,
  rankBySpeed,
  sampleBps,
  type ReleaseJson,
  type SpeedSample,
  type UpdateAsset,
  type UpdateCheckResult,
  type UpdateProgress,
} from '../../shared/update';
import { cacheDir } from '../util/paths';
import { dispatchChain } from '../net/proxy';
import type { Logger } from '../../shared/types';
import { discardUpdateBody, downloadVerifiedUpdate, verifyUpdateFile } from './updateTransfer';

const agent = new Agent({ connect: { timeout: 20000 } });
const UA = 'Win-Box-Updater';

/** 小样本测速窗口（筛出前列）/ 大样本复测窗口（定胜负） */
const PROBE_SMALL = { bytes: ACCEL_PROBE_BYTES, ms: ACCEL_PROBE_MS, headersTimeout: 2500 };
const PROBE_BIG = { bytes: 1536 * 1024, ms: 3000, headersTimeout: 3000 };
/** 视为「该线路可用」的最小样本字节数（挡住加速站返回的错误页/秒断） */
const SPEED_MIN_BYTES = 64 * 1024;

export class UpdateService {
  private lastAsset: UpdateAsset | null = null;
  private verified: { path: string; asset: UpdateAsset } | null = null;
  private downloadController: AbortController | null = null;
  private userCanceled = false;

  constructor(private readonly log: Logger) {}

  /** 安装包落盘目录（应用私有缓存；`cacheDir()/update`） */
  private updateDir(): string {
    return join(cacheDir(), 'update');
  }

  /**
   * 检查更新。**任何失败都返回 updateAvailable=false**（不锁死软件），并带上 error 说明。
   * updateAvailable=true 的条件：远端版本更高 **且** 找到 Setup 安装包。
   * ★ 2026-09-30：候选地址（代理优先 + 直连）**并发抢首响**，第一个 200 即用，其余立即放弃。
   */
  async check(): Promise<UpdateCheckResult> {
    const localVersion = app.getVersion();
    const base: UpdateCheckResult = { localVersion, remoteVersion: '', tag: '', updateAvailable: false };

    this.lastAsset = null;
    this.verified = null;
    const { json, lastErr } = await this.fetchLatestRelease();
    if (!json) {
      this.log.w(`更新检查失败（按「无更新」放行）：${lastErr}`);
      return { ...base, error: lastErr || '网络不可达' };
    }

    const rel = parseLatestRelease(json);
    const newer = !json.draft && !json.prerelease && isUpdateAvailable(localVersion, rel.version);
    const chosen = newer ? pickSetupAsset(rel.assets, rel.version) : null;
    let asset: UpdateAsset | undefined;
    try { if (chosen) asset = trustedUpdateAsset(chosen, rel.tag); } catch (error) {
      this.lastAsset = null;
      this.verified = null;
      return { ...base, remoteVersion: rel.version, tag: rel.tag, error: (error as Error).message };
    }
    if (newer && !asset) this.log.w(`更新检查：远端 ${rel.version} 更高，但未找到 .exe 安装包，跳过更新提示`);
    if (newer && asset) this.log.i(`更新检查：本地 ${localVersion} < 远端 ${rel.version}，提示用户更新（${asset.name}）`);

    this.lastAsset = asset || null;
    return {
      localVersion,
      remoteVersion: rel.version,
      tag: rel.tag,
      updateAvailable: !!asset,
      releaseName: rel.name,
      releaseNotes: rel.notes,
      publishedAt: rel.publishedAt,
      asset,
    };
  }

  /** 已下载完成的安装包绝对路径（未下载 → ''） */
  downloadedPath(): string {
    return this.verified && existsSync(this.verified.path) ? this.verified.path : '';
  }

  /**
   * ★ 2026-09-30：并发抢首响拉最新 Release（代理链路优先 + 直连垫底）。
   * 全部候选同时发起，谁先回 200 就用谁，其余立刻放弃 —— 既满足「优先走代理」，
   * 又不会因为某条线路不可达白等（串行时每条 8s，最坏 40s+）。
   */
  private async fetchLatestRelease(): Promise<{ json: ReleaseJson | null; lastErr: string }> {
    let lastErr = '无法连接 GitHub 官方接口';
    for (const dispatcher of dispatchChain(UPDATE_RELEASES_API, agent)) {
      try {
        const response = await request(UPDATE_RELEASES_API, {
          method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
          headersTimeout: 8000, bodyTimeout: 8000, signal: AbortSignal.timeout(12_000), dispatcher,
        });
        if (response.statusCode !== 200) { discardUpdateBody(response.body); throw new Error('GitHub HTTP ' + response.statusCode); }
        const text = await response.body.text();
        if (text.length > 2_000_000) throw new Error('发布信息过大');
        const json: unknown = JSON.parse(text);
        if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('发布信息格式无效');
        return { json: json as ReleaseJson, lastErr: '' };
      } catch (error) { lastErr = error instanceof Error ? error.message : String(error); }
    }
    return { json: null, lastErr };
  }

  /**
   * ★ 2026-09-30（用户要求「池子多一些、挑下载速度最快的下载」）：**两段测速**。
   *   池子有 80 条候选，直接对每条跑大样本测速 = 每条 1.5MB 起（合计上百 MB），不可接受。
   *   ① 小样本筛选：对前 `ACCEL_PROBE_LIMIT` 条并发（`ACCEL_PROBE_CONCURRENCY`）各拉 ≤96KB/2.2s，
   *      速率按**去掉首字节**的段算（小窗口下 TTFB 会带偏排名，实测同一节点 64KB 与 2MB 样本差 20 倍）；
   *   ② 大样本复测：小样本前 `ACCEL_FINALISTS` 名再各拉 ≤1.5MB/3s，用真实持续速率定胜负。
   *   返回 = 下载候选顺序（复测冠军打头 → 其余入围者 → 其余存活线路 → 直连垫底）。
   */
  private async speedTest(urls: string[], onProgress: (p: UpdateProgress) => void, signal: AbortSignal): Promise<string[]> {
    if (urls.length <= 1) return urls;
    const pool = urls.slice(0, ACCEL_PROBE_LIMIT);
    const rest = urls.slice(ACCEL_PROBE_LIMIT);
    onProgress({
      phase: 'speedtest',
      received: 0,
      total: 0,
      percent: 0,
      speed: 0,
      message: `正在为 ${pool.length} 条下载线路测速…`,
    });
    const small = await this.collectSamples(pool, PROBE_SMALL, ACCEL_PROBE_CONCURRENCY, signal);
    signal.throwIfAborted();
    const alive = small.filter((s) => s.ok && s.bytes >= SPEED_MIN_BYTES).sort((a, b) => sampleBps(b) - sampleBps(a));
    for (const s of alive.slice(0, 8)) this.log.i(`更新测速(小样本)：${this.hostOf(s.url)} ${Math.round(sampleBps(s) / 1024)} KB/s（${Math.round((s.ms - (s.ttfb || 0)))}ms）`);
    if (!alive.length) {
      this.log.w(`更新测速：${pool.length} 条候选全部不可用（改按原顺序尝试下载）`);
      return [...pool, ...rest];
    }

    const finalists = alive.slice(0, ACCEL_FINALISTS);
    const big = await this.collectSamples(finalists.map((s) => s.url), PROBE_BIG, finalists.length, signal);
    signal.throwIfAborted();
    for (const s of big) this.log.i(`更新测速(复测)：${this.hostOf(s.url)} ${Math.round(sampleBps(s) / 1024)} KB/s（${s.bytes}B/${s.ms}ms）`);
    const ranked = [
      ...rankBySpeed(big, SPEED_MIN_BYTES),
      ...alive.slice(ACCEL_FINALISTS).map((s) => s.url),
      ...small.filter((s) => !alive.includes(s)).map((s) => s.url),
      ...rest,
    ];
    const best = big.find((s) => s.url === ranked[0]) || finalists.find((s) => s.url === ranked[0]);
    onProgress({
      phase: 'speedtest',
      received: 0,
      total: 0,
      percent: 0,
      speed: best ? sampleBps(best) : 0,
      message: best ? `最快线路：${this.hostOf(best.url)}（${Math.round(sampleBps(best) / 1024)} KB/s）` : '',
    });
    return [...new Set(ranked)];
  }

  private hostOf(url: string): string {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }

  /**
   * 并发（限流）测速并**限总时长**收集样本：整段最多 `ms + 800ms`（不该被最慢的线路拖住 ——
   * 实测直连 GitHub 会超时，串等会让"测速"花 8s+）。到点仍没回样本的线路按不可用记，
   * 仍保留在候选末尾作回退。
   */
  private async collectSamples(
    urls: string[],
    opts: { bytes: number; ms: number; headersTimeout: number },
    concurrency: number,
    signal: AbortSignal,
  ): Promise<SpeedSample[]> {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const deadline = setTimeout(() => controller.abort(), opts.ms + 800);
    const got: Array<SpeedSample | null> = urls.map(() => null);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < urls.length && !combined.aborted) {
        const i = cursor++;
        try {
          got[i] = await this.probeSpeed(urls[i], opts, combined);
        } catch {
          got[i] = { url: urls[i], bytes: 0, ms: 0, ok: false };
        }
      }
    };
    try { await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, urls.length)) }, worker)); }
    finally { clearTimeout(deadline); controller.abort(); }
    return urls.map((u, i) => got[i] ?? { url: u, bytes: 0, ms: 0, ok: false });
  }

  /**
   * 单线路限时测速：带 Range 只取头部，收满 `bytes` 或到 `ms` 即断（记 TTFB）。
   * 加速站不支持 Range 时也能用（收到窗口上限就主动 abort，不整包下载）。
   */
  private async probeSpeed(url: string, opts: { bytes: number; ms: number; headersTimeout: number }, signal: AbortSignal): Promise<SpeedSample> {
    const ac = new AbortController();
    const t0 = Date.now();
    let first = 0;
    let bytes = 0;
    let ok = false;
    try {
      const res = await request(url, {
        method: 'GET',
        headers: { 'User-Agent': UA, Range: `bytes=0-${opts.bytes - 1}` },
        headersTimeout: opts.headersTimeout,
        bodyTimeout: opts.ms + 500,
        signal: AbortSignal.any([signal, ac.signal]),
        dispatcher: dispatchChain(url, agent)[0],
      });
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        await res.body.dump();
        return { url, bytes: 0, ms: Date.now() - t0, ok: false };
      }
      ok = true;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { ac.abort(); resolve(); }, opts.ms);
        res.body.on('data', (c: Buffer) => {
          if (!first) first = Date.now();
          bytes += c.length;
          if (bytes >= opts.bytes) {
            clearTimeout(timer);
            ac.abort();
            resolve();
          }
        });
        res.body.on('end', () => { clearTimeout(timer); resolve(); });
        res.body.on('error', () => { clearTimeout(timer); resolve(); });
      });
    } catch {
      // abort 属预期（测速窗口到）；其它异常按不可用处理
      return { url, bytes, ms: Date.now() - t0, ok: ok && bytes > 0, ttfb: first ? first - t0 : 0 };
    }
    return { url, bytes, ms: Date.now() - t0, ok, ttfb: first ? first - t0 : 0 };
  }

  cancel(): boolean {
    if (!this.downloadController) return false;
    this.userCanceled = true;
    this.downloadController.abort(new Error('已取消更新下载'));
    return true;
  }

  async download(onProgress: (p: UpdateProgress) => void): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }> {
    if (this.downloadController) return { ok: false, error: '更新下载正在进行中' };
    const asset = this.lastAsset;
    if (!asset) return { ok: false, error: '没有可校验的安装包，请重新检查更新' };
    const controller = new AbortController();
    this.downloadController = controller;
    this.userCanceled = false;
    this.verified = null;
    const deadline = setTimeout(() => controller.abort(new Error('更新下载超时，请重试')), 30 * 60_000);
    try {
      let urls = asset.accelUrls;
      try { urls = await this.speedTest(urls, onProgress, controller.signal); } catch { controller.signal.throwIfAborted(); }
      const path = await downloadVerifiedUpdate(asset, this.updateDir(), urls, controller.signal, onProgress);
      this.verified = { path, asset };
      onProgress({ phase: 'done', received: asset.size, total: asset.size, percent: 100, speed: 0, message: '安装包校验通过' });
      return { ok: true, path };
    } catch (error) {
      const message = controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason.message : error instanceof Error ? error.message : String(error);
      const canceled = this.userCanceled;
      onProgress({ phase: canceled ? 'canceled' : 'error', received: 0, total: asset.size, percent: 0, speed: 0, error: canceled ? undefined : message, message });
      return { ok: false, error: message, canceled };
    } finally { clearTimeout(deadline); this.downloadController = null; }
  }

  async launch(path: string): Promise<{ ok: boolean; error?: string }> {
    const verified = this.verified;
    if (!verified || verified.path !== path) return { ok: false, error: '安装包尚未校验，请重新下载' };
    try {
      await verifyUpdateFile(path, verified.asset);
      const error = await shell.openPath(path);
      if (error) return { ok: false, error };
      return { ok: true };
    } catch (error) { this.verified = null; return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}
