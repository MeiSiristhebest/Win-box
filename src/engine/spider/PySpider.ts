// src/engine/spider/PySpider.ts
// .py 蜘蛛的引擎适配器：通过 PythonSpiderRuntimePort 调用嵌入式 CPython3。
// 上游 python 蜘蛛（Chalice/CPython3）由桌面端内置嵌入式 CPython3 运行时执行：脚本含
// `class Spider`，方法 homeContent/categoryContent/detailContent/searchContent/playerContent
// 返回 dict/list，由 python-runner/runner.py 序列化成 JSON 回传。依赖 lxml/requests 的源
// 可运行（运行时随附 wheel）；依赖其他第三方库的源会 ImportError —— translateSpiderLog
// 已就这一局限给出诚实文案。
import { Spider, type SpiderInit } from './Spider';
import type { PythonSpiderRuntimePort } from './PythonSpiderRuntimePort';
import type { PythonSpiderScriptFailureCode, PythonSpiderScriptPort } from './PythonSpiderScriptPort';
import { SourceProblemError } from './errors';
import { enrichExt } from './driveExt';
import { spiderCallOutput, type SpiderCallResult } from './spiderCallResult';
import { abortError, awaitWithAbort, throwIfAborted } from '../util/abort';

export class PySpider extends Spider {
  /** .py 里的类名（api 查询串 `name=`/`class=`，缺省 Spider） */
  private clsName: string;
  /** 已下载到本地的脚本路径 */
  private pyPath = '';
  private ready = false;
  /** 准备期失败原因（脚本下载/缓存），优先于调用期原因 */
  private loadError = '';
  private preparation: Promise<boolean> | null = null;
  /** ★ 后台预热进行中标记（幂等：预热失败时 prewarm 会再次触发，避免递归/重复下载） */
  private warmupRunning = false;

  constructor(
    init: SpiderInit,
    private readonly runtime: PythonSpiderRuntimePort,
    private readonly scripts: PythonSpiderScriptPort,
  ) {
    super(init);
    // http://…/x.py?name=Cls&extend=… → className 默认 Spider
    let cls = 'Spider';
    const q = init.api.indexOf('?');
    if (q >= 0) {
      try {
        for (const [k, v] of new URLSearchParams(init.api.slice(q + 1))) {
          if ((k === 'name' || k === 'class') && v) cls = v;
        }
      } catch {
        /* 解析失败就用默认 Spider */
      }
    }
    this.clsName = cls;
  }

  /**
   * ★ 预热常驻 Python（由 SpiderHost.prewarmSpiders 调度）：仅当脚本**已落盘**
   * （本地 .py 或已缓存的下载脚本）且嵌入式运行时已就绪时生效 —— 预热不触发任何下载。
   * @returns 实际新起的进程数
   */
  /**
   * ★ 运行时就绪判定（同步）：脚本与嵌入式 Python 运行时都已落盘才算就绪。
   * 'unavailable' = 还没就绪（全源搜索本次跳过；**绝不触发 11MB 运行时下载**，下载由正常单源使用触发）
   */
  runtimeState(): 'ready' | 'unavailable' {
    const script = this.scripts.status(this.scriptBase());
    if (!script?.available) return 'unavailable';
    return this.runtime.pyRuntimeReady() ? 'ready' : 'unavailable';
  }

  isRuntimeReady(): boolean {
    return this.runtimeState() === 'ready';
  }

  /** Python 侧无「正在进行的准备」概念（不预下载）→ 恒 null */
  pendingRuntime(): Promise<unknown> | null {
    return null;
  }

  /**
   * ★ 2026-09-24 后台预热（不阻塞、幂等）：由 SpiderHost 在配置就绪/清缓存后调度 ——
   *   ① 脚本未落盘 → 后台下载（首次进源不再现付脚本下载）；
   *   ② 嵌入式 Python 运行时未就绪 → 后台下载 + 解压 + 装依赖（11MB 级，本项是「首次特别慢」的主因）；
   *   ③ 两者都就绪 → 顺带深度预热一个常驻进程（预建实例，含 init(ext)）。
   *   任何失败静默：首次正常调用时会重试并把真实原因上屏。
   */
  warmup(): void {
    if (this.warmupRunning) return; // 幂等：同一源只跑一份预热
    this.warmupRunning = true;
    void (async () => {
      try {
        if (!await this.ensureReady()) return;
        await this.runtime.prewarmPythonRuntime();
        // 运行时确已就绪 → 顺带深度预热常驻进程（直接调 bridge，避免再落回 warmup 造成递归）
        if (this.ready && this.runtime.pyRuntimeReady()) {
          this.runtime.prewarmPython(this.pyPath, this.clsName, 1, enrichExt(this.ext || '', this.host?.driveTokens?.()), this.siteKey);
        }
      } catch { /* 预热失败静默：首次正常调用会重试并上屏真实原因 */ } finally {
        this.warmupRunning = false;
      }
    })();
  }

  prewarm(count = 1): number {
    const script = this.scripts.status(this.scriptBase());
    // ★ 脚本/运行时尚未就绪 → 转入后台预热（脚本下载 + 运行时准备），本轮不新起进程
    if (!script?.available || !this.runtime.pyRuntimeReady()) {
      this.warmup();
      return 0;
    }
    // ★ 深度预热：同 Java 侧 —— 预建实例（含 init(ext)）进 python 侧实例缓存
    return this.runtime.prewarmPython(script.path, this.clsName, count, enrichExt(this.ext || '', this.host?.driveTokens?.()), this.siteKey);
  }

  /** Resolve a script through the injected port; filesystem and network I/O stay in the main adapter. */
  private ensureReady(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    if (this.preparation) return this.preparation;

    const preparation = this.prepareScript();
    this.preparation = preparation;
    const clearPreparation = (): void => {
      if (this.preparation === preparation) this.preparation = null;
    };
    void preparation.then(clearPreparation, clearPreparation);
    return preparation;
  }

  private async prepareScript(): Promise<boolean> {
    try {
      const result = await this.scripts.load(this.scriptBase());
      if (result.status === 'failed') {
        this.loadError = pythonScriptFailureMessage(result.code, result.detail);
        return false;
      }
      this.pyPath = result.path;
      this.ready = true;
      this.loadError = '';
      return true;
    } catch (e) {
      this.loadError = `python 脚本加载失败：${(e as Error).message || String(e)}`;
      return false;
    }
  }

  private scriptBase(): string {
    return (this.api || '').split('?')[0];
  }

  /**
   * 调用 .py 方法。第一段 arg = ext（runner.py 喂给 init），其余为方法实参。
   * 脚本下载/缓存失败时直接抛 SourceProblemError（A1），不静默返回空串。
   * @param timeoutMs 可选调用方预算（搜索会传更紧的值）；缺省沿用源配置的超时预算。
   */
  private async call(method: string, args: string[], timeoutMs?: number, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const ready = await awaitWithAbort(this.ensureReady(), signal);
    throwIfAborted(signal);
    if (!ready) {
      // A1：脚本下载/缓存失败不再静默返回空串，直接抛错上屏
      throw new SourceProblemError('SPIDER_ERROR', this.loadError, { sourceKey: this.siteKey });
    }
    throwIfAborted(signal);
    let result: SpiderCallResult;
    try {
      result = await this.runtime.callPython(
        this.pyPath,
        this.clsName,
        method,
        [this.enrichedExt(), ...args],
        timeoutMs ?? this.timeoutMs,
        this.siteKey,
        signal,
      );
    } catch (e) {
      if (signal?.aborted) throw abortError(signal);
      // Runtime setup reports PY_UNSUPPORTED explicitly; unexpected execution failures
      // must not be mislabeled as a missing Python installation.
      if (e instanceof SourceProblemError) throw e;
      throw new SourceProblemError('SPIDER_ERROR', e instanceof Error ? e.message : String(e), {
        sourceKey: this.siteKey,
        operation: method,
      });
    }
    throwIfAborted(signal);
    return spiderCallOutput(result, this.siteKey, method);
  }

  /** init(Context, ext) 的 ext：把宿主网盘 token 实时并入 ext 顶层（与 JarSpider 一致）。 */
  private enrichedExt(): string {
    return enrichExt(this.ext || '', this.host?.driveTokens?.());
  }

  get lastReason(): string {
    return this.loadError;
  }

  homeContent(_filter: boolean, signal?: AbortSignal): Promise<string> {
    return this.call('homeContent', [], undefined, signal);
  }
  homeVideoContent(signal?: AbortSignal): Promise<string> {
    return this.call('homeVideoContent', [], undefined, signal);
  }
  categoryContent(tid: string, pg: string, _filter: boolean, extend: Record<string, string>, signal?: AbortSignal): Promise<string> {
    // extend 以 JSON 字符串传入，Python 侧 json.loads 解析
    return this.call('categoryContent', [tid, pg, JSON.stringify(extend || {})], undefined, signal);
  }
  detailContent(ids: string[]): Promise<string> {
    // ids 以 JSON 数组字符串传入，runner.py 用 json.loads 还原为 Python list
    return this.call('detailContent', [JSON.stringify(ids || [])]);
  }
  searchContent(key: string, quick: boolean, timeoutMs?: number, signal?: AbortSignal): Promise<string> {
    return this.call('searchContent', [key, String(quick)], timeoutMs, signal);
  }
  searchContentPage(key: string, quick: boolean, pg: string, timeoutMs?: number, signal?: AbortSignal): Promise<string> {
    return this.call('searchContent', [key, String(quick), pg], timeoutMs, signal);
  }
  playerContent(flag: string, id: string, vipFlags: string[]): Promise<string> {
    // A2：vipFlags 以 JSON 数组传入，runner.py 解析成 list 交给 python 蜘蛛
    return this.call('playerContent', [flag, id, JSON.stringify(vipFlags || [])]);
  }
  liveContent(url: string): Promise<string> {
    return this.call('liveContent', [url]);
  }
  proxy(params: Record<string, string>): Promise<string> {
    return this.call('proxy', [JSON.stringify(params || {})]);
  }
  async destroy(): Promise<void> {
    this.ready = false;
  }
}

function pythonScriptFailureMessage(code: PythonSpiderScriptFailureCode, detail?: string): string {
  switch (code) {
    case 'INVALID_ADDRESS':
      return 'python 蜘蛛 api 不是 http(s) 或 file:// 脚本地址，无法获取脚本';
    case 'INVALID_FILE_URL':
      return `本地 .py 路径无法解析（file:// 格式不正确）：${detail || ''}`;
    case 'LOCAL_SCRIPT_MISSING':
      return '本地 .py 文件不存在（可能已被移动或删除），请重新导入配置';
    case 'SCRIPT_EMPTY':
      return 'python 脚本下载失败（内容为空，源可能已失效）';
    case 'SCRIPT_DOWNLOAD_FAILED':
      return `python 脚本加载失败：${detail || '下载失败'}`;
  }
}
