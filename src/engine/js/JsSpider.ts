// src/engine/js/JsSpider.ts
// type=3 且 api 以 .js 结尾的蜘蛛 —— 把 Spider 基类调用转发到 JsSandbox 里的蜘蛛对象。
// 惰性初始化：第一次任一方法调用才加载脚本建沙箱；缺少操作、加载失败、执行失败和超时
// 通过 SourceProblemError 保留各自原因，合法空结果仍按引擎字符串契约返回空字符串。
//
// 方法名映射说明（重要）：安卓 JsSpider.java 里引擎调用的是 JS 侧的
//   init / home / homeVod / category / detail / search / play / live（见 JsSpider.java:176-239）；
// 而 libmedia "cat" 生态新式蜘蛛导出 homeContent / categoryContent / detailContent / ...
// 两套命名都支持（callJs 传候选名列表），并以"方法名探测"日志记录实际命中的风格。
import { Spider, type SpiderInit } from '../spider/Spider';
import { JsSandbox } from './JsSandbox';
import type { JsSpiderRuntimePort } from './JsSandboxPort';
import type { JsSpiderHostPort } from '../spider/SpiderPorts';
import { enrichExt } from '../spider/driveExt';
import { SourceProblemError, sourceProblemCodeForReason } from '../spider/errors';
import { UnsupportedSourceError } from '../util/errors';
import { abortError, throwIfAborted } from '../util/abort';

/** 调用超时：首页/分类 20s，其它 15s（任务书约定） */
const TIMEOUT_HOME = 20000;
const TIMEOUT_OTHER = 15000;

type JsSpiderInit = Omit<SpiderInit, 'host'> & { host: JsSpiderHostPort };

export class JsSpider extends Spider {
  private sandbox: JsSpiderRuntimePort | null = null;

  constructor(init: JsSpiderInit) {
    super(init);
    // ★ 网盘绑定凭据并入 ext（与 JarSpider.enrichedExt 同一实现）：
    //   JS 蜘蛛的 ext 仅在沙箱首次加载时经 init 转发给蜘蛛（JsSandbox.forwardInit），
    //   不并入则"扫码绑定网盘 → JS 源调盘内资源"链路断裂（任务 #17 缺口①）。
    this.ext = enrichExt(this.ext || '', init.host?.driveTokens?.());
    // ★★ 2026-09-30：执行侧可插拔 —— 主进程注入 worker 池（同步 req 不再冻主进程，
    //   死循环/超时直接 terminate）；单测与降级路径不注入 → 进程内 node:vm（行为与旧版一致）。
    const make = init.host.jsSandboxFactory;
    if (make) {
      this.sandbox = make({ siteKey: init.key, api: init.api, ext: this.ext, host: init.host, jsLibDir: init.host.jsLibDir ?? '' });
    } else {
      // 降级路径（未注入工厂：单测/CLI/异常装配）——同步 req() 会以 spawnSync 阻塞本进程，必须留痕
      init.host.logger.w(`spider js:${init.key} 执行侧=进程内（宿主未注入 worker 池，同步 req 会阻塞界面）`);
      this.sandbox = new JsSandbox({
        siteKey: init.key,
        api: init.api,
        ext: this.ext,
        host: init.host,
        jsLibDir: init.host.jsLibDir ?? '',
      });
    }
  }

  /** init(Context, extend)：记录 ext；首次调用时随加载一并转发给蜘蛛的 init */
  override init(extend: string): void {
    this.ext = enrichExt(extend || '', this.host?.driveTokens?.());
    this.sandbox?.setExt(this.ext);
  }

  /** 惰性获取沙箱；每次加载失败保留类型和来源身份，瞬时错误允许沙箱重试。 */
  private async getSandbox(signal?: AbortSignal): Promise<JsSpiderRuntimePort> {
    throwIfAborted(signal);
    if (!this.sandbox) {
      throw new SourceProblemError('SPIDER_ERROR', 'JS 沙箱不可用', { sourceKey: this.siteKey });
    }
    try {
      await this.sandbox.ensureLoaded(signal);
      throwIfAborted(signal);
      return this.sandbox;
    } catch (e) {
      if (signal?.aborted) throw abortError(signal);
      if (e instanceof SourceProblemError) throw e;
      if (e instanceof UnsupportedSourceError) {
        const code = sourceProblemCodeForReason(e.message);
        throw new SourceProblemError(code, e.reason || e.message, { sourceKey: this.siteKey });
      }
      const message = e instanceof Error ? e.message : String(e);
      this.host.logger.e(`spider js:${this.siteKey} 执行器加载失败（${message}）api=${this.api}`);
      throw new SourceProblemError('SPIDER_ERROR', message, { sourceKey: this.siteKey });
    }
  }

  /** 调用一组候选名并字符串化结果 */
  private async callStr(names: string[], args: unknown[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const sb = await this.getSandbox(signal);
    return this.stringify(await this.callRuntimeMethod(sb, names, args, timeoutMs, names[0] ?? 'unknown', signal));
  }

  /** Normalize failures from any substitutable runtime to the Spider boundary error contract. */
  private async callRuntimeMethod(
    sandbox: JsSpiderRuntimePort,
    names: string[],
    args: unknown[],
    timeoutMs: number,
    operation: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      const result = signal
        ? await sandbox.callMethod(names, args, timeoutMs, signal)
        : await sandbox.callMethod(names, args, timeoutMs);
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (error instanceof SourceProblemError) throw error;
      if (error instanceof UnsupportedSourceError) {
        throw new SourceProblemError(sourceProblemCodeForReason(error.message), error.reason || error.message, {
          sourceKey: this.siteKey,
          operation,
        });
      }
      throw new SourceProblemError('SPIDER_ERROR', error instanceof Error ? error.message : String(error), {
        sourceKey: this.siteKey,
        operation,
      });
    }
  }

  /** 多传的分页参数会被 JS 忽略；不能根据合法 undefined 结果重复执行带副作用的搜索。 */
  private async callSearch(key: string, quick: boolean, pg: string, timeoutMs = TIMEOUT_OTHER, signal?: AbortSignal): Promise<string> {
    const sb = await this.getSandbox(signal);
    const r = await this.callRuntimeMethod(sb, ['searchContent', 'search'], [key, quick, pg], timeoutMs, 'searchContent', signal);
    return this.stringify(r);
  }

  /** 结果字符串化：string 直通；object → JSON；null/undefined → ''（引擎契约全部返回 String） */
  private stringify(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v) ?? '';
    } catch {
      return String(v);
    }
  }

  // ---------------- Spider 方法映射 ----------------
  override async homeContent(filter: boolean, signal?: AbortSignal): Promise<string> {
    return this.callStr(['homeContent', 'home'], [filter], TIMEOUT_HOME, signal);
  }

  override async homeVideoContent(signal?: AbortSignal): Promise<string> {
    return this.callStr(['homeVideoContent', 'homeVod', 'homeVid'], [], TIMEOUT_HOME, signal);
  }

  override async categoryContent(
    tid: string,
    pg: string,
    filter: boolean,
    extend: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.callStr(['categoryContent', 'category'], [tid, pg, filter, extend ?? {}], TIMEOUT_HOME, signal);
  }

  override async detailContent(ids: string[]): Promise<string> {
    return this.callStr(['detailContent', 'detail'], [ids?.[0] ?? ''], TIMEOUT_OTHER);
  }

  override async searchContent(key: string, quick: boolean, timeoutMs?: number, signal?: AbortSignal): Promise<string> {
    return this.callSearch(key, quick, '1', timeoutMs, signal);
  }

  override async searchContentPage(
    key: string,
    quick: boolean,
    pg: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.callSearch(key, quick, pg, timeoutMs, signal);
  }

  /**
   * 播放信息：返回安卓契约 JSON：{parse, url, playUrl, flag, header, jx, msg}。
   * 蜘蛛返回什么就透传什么（归一化由上层 SourceViewModel/CmsSource 处理）。
   */
  override async playerContent(flag: string, id: string, vipFlags: string[]): Promise<string> {
    return this.callStr(['playerContent', 'play'], [flag, id, vipFlags ?? []], TIMEOUT_OTHER);
  }

  override async liveContent(url: string): Promise<string> {
    return this.callStr(['liveContent', 'live'], [url], TIMEOUT_OTHER);
  }

  /** webview 嗅探判断 —— Windows v1 无嗅探，恒 false */
  override isVideoFormat(_url: string): boolean {
    return false;
  }

  override manualVideoCheck(): boolean {
    return false;
  }

  /** 脚本 action 与基类使用同一可等待结果契约。 */
  override action(action: string): Promise<string | null> {
    return this.callStr(['action'], [action], TIMEOUT_OTHER)
      .then((s) => (s ? s : null))
      .catch((error: unknown) => {
        if (error instanceof SourceProblemError && error.code === 'OPERATION_UNSUPPORTED') return null;
        throw error;
      });
  }

  /**
   * 本地代理 —— v1 简化实现：调蜘蛛的 localProxy/proxy(params)。
   * 安卓有 from=catvod 的 cat 协议分支（proxy2，JsSpider.java:590-608），v1 未做——
   * 上游用该协议代理图片/m3u8 的源会降级，已在回传报告中说明。
   */
  override proxyLocal(params: Record<string, string>): Promise<unknown[] | null> {
    return this.callProxy(params);
  }

  private async callProxy(params: Record<string, string>): Promise<unknown[] | null> {
    const sb = await this.getSandbox();
    let r: unknown;
    try {
      r = await this.callRuntimeMethod(sb, ['localProxy', 'proxy', 'proxyLocal'], [params ?? {}], TIMEOUT_OTHER, 'proxy');
    } catch (error) {
      if (error instanceof SourceProblemError && error.code === 'OPERATION_UNSUPPORTED') return null;
      throw error;
    }
    if (Array.isArray(r) && r.length >= 2) {
      // 沙箱蜘蛛常返回 [mimeType, content] 或 [status, contentType, content, header?]
      if (r.length >= 3 && typeof r[0] === 'number') return [r[1], r[2]];
      return [r[0], r[1]];
    }
    return null;
  }

  /** 销毁：释放 vm 上下文；之后调用一律返回空 */
  override destroy(): void {
    this.sandbox?.destroy();
    this.sandbox = null;
  }

  override cancelByTag(): void {
    // node:vm 沙箱没有按 tag 取消 HTTP 的通道（host.http 无 cancel API），v1 no-op
  }
}
