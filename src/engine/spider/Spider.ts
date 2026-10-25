// src/engine/spider/Spider.ts
// 抽象基类，1:1 对齐 ref/app__src__main__java__com__github__catvod__crawler__Spider.java。
// 默认返回空/降级值，子类按需覆写。Spider.java 的 Context/OkHttpClient 在 Windows 移植中
// 由注入的 EngineHost（ports.ts）替代，因此 init 签名简化为 (ext)。
import type { SpiderRuntimeHostPort } from './SpiderPorts';

export interface SpiderInit<THost extends SpiderRuntimeHostPort = SpiderRuntimeHostPort> {
  key: string;
  api: string;
  ext: string;
  jar: string;
  host: THost;
  /**
   * 源级调用超时（ms）：来自配置 `timeout`（秒）。JVM/CPython 子进程调用按它设超时，
   * 与聚合搜索的单源超时对齐（「源声明多久就该多久内出结果」）。缺省 20s。
   */
  timeoutMs?: number;
}

/** 蜘蛛调用的兜底超时（源未声明 timeout 时用；与 JarSpiderBridge.callTimeoutMs 默认一致） */
export const DEFAULT_SPIDER_TIMEOUT_MS = 20_000;

/** 爬虫返回的 JSON 字符串契约（与安卓一致：所有方法返回 String） */
export abstract class Spider {
  siteKey: string;
  protected api = '';
  protected ext = '';
  protected jar = '';
  protected host!: SpiderRuntimeHostPort;
  /** 源级调用超时（ms），子进程调用用（见 SpiderInit.timeoutMs） */
  readonly timeoutMs: number;

  constructor(init: SpiderInit) {
    this.siteKey = init.key;
    this.api = init.api;
    this.ext = init.ext;
    this.jar = init.jar;
    this.host = init.host;
    this.timeoutMs = init.timeoutMs && init.timeoutMs > 0 ? init.timeoutMs : DEFAULT_SPIDER_TIMEOUT_MS;
  }

  /** init(Context, extend) —— 安卓用 extend 做站点私有配置 */
  init(extend: string): void {
    this.ext = extend;
  }

  /**
   * 兼容入口：运行时准备失败原因（可读短句，空串=无线索）。
   * JAR/Python 的执行期错误随调用传播，不从这里读取并发调用的诊断。
   */
  get lastReason(): string {
    return '';
  }

  /** 首页分类 + 推荐。filter=true 时返回分类筛选 */
  homeContent(_filter: boolean): Promise<string> | string {
    return '';
  }

  /** 首页最近更新（homeContent 不含时用） */
  homeVideoContent(): Promise<string> | string {
    return '';
  }

  /** 分类列表：tid=分类id, pg=页码, extend=筛选参数 */
  categoryContent(_tid: string, _pg: string, _filter: boolean, _extend: Record<string, string>): Promise<string> | string {
    return '';
  }

  /** 详情：ids[0]=vod_id */
  detailContent(_ids: string[]): Promise<string> | string {
    return '';
  }

  /**
   * 搜索：quick=是否快速搜索。
   * @param timeoutMs 可选的**调用方预算**（聚合搜索会传比源声明更紧的值以加速出结果；
   *                  子进程蜘蛛据此设超时，缺省用源声明 timeout）。
   */
  searchContent(key: string, quick: boolean, timeoutMs?: number, signal?: AbortSignal): Promise<string> | string {
    void key; void quick; void timeoutMs; void signal;
    return '';
  }

  searchContentPage(key: string, quick: boolean, pg: string, timeoutMs?: number, signal?: AbortSignal): Promise<string> | string {
    return this.searchContent(key, quick, timeoutMs, signal);
  }

  /** 播放信息：flag=播放源标识, id=剧集id, vipFlags=需解析的flag列表 */
  playerContent(_flag: string, _id: string, _vipFlags: string[]): Promise<string> | string {
    return '';
  }

  /** webview 嗅探时判断 url 是否视频 —— Windows v1 不做嗅探，恒 false */
  isVideoFormat(_url: string): boolean {
    return false;
  }

  manualVideoCheck(): boolean {
    return false;
  }

  /** 直播列表（lives.type=3 的 .js 源） */
  liveContent(_url: string): Promise<string> | string {
    return '';
  }

  cancelByTag(): void {}

  destroy(): void | Promise<void> {}

  /** 本地代理：返回 [mimeType, bytes/Stream]；脚本运行时可异步提供响应。 */
  proxyLocal(_params: Record<string, string>): unknown[] | null | Promise<unknown[] | null> {
    return null;
  }

  /** 代理/源内绑定入口：返回 JSON 字符串（二维码/输入框/302 结构），由调用方解析渲染 */
  proxy(params: Record<string, string>): Promise<string> | string {
    const result = this.proxyLocal(params);
    const serialize = (response: unknown[] | null): string => response == null ? '' : JSON.stringify(response);
    // Preserve synchronous implementations while waiting for async adapters before serialization.
    return result == null || Array.isArray(result) ? serialize(result) : result.then(serialize);
  }

  action(_action: string): string | null | Promise<string | null> {
    return null;
  }

  /**
   * ★ 2026-10-09：该源在蜘蛛 JVM 内「宿主代理」的端口（`/proxy/<port>` 转发用）。
   * 仅 jar 蜘蛛在**至少成功调用过一次**后才有值（桥在拼 argv 时按加载器参数确定性分配并登记）；
   * 其余形态恒 null —— 调用方据此决定「jar 自解链改写」是否可用。
   */
  proxyPort(): number | null {
    return null;
  }
}

/** Operations whose default implementations are compatibility stubs, not capabilities. */
export type SpiderOperation =
  | 'homeContent'
  | 'homeVideoContent'
  | 'categoryContent'
  | 'detailContent'
  | 'searchContent'
  | 'playerContent'
  | 'liveContent'
  | 'proxyPort';

/**
 * Keeps the upstream-compatible base class out of application capability decisions.
 * An override is supported even when it returns a legitimate empty result; inherited
 * base stubs are unsupported and must be reported as such by the boundary adapter.
 */
export function isSpiderOperationImplemented(spider: Spider, operation: SpiderOperation): boolean {
  const implementation = spider[operation];
  const compatibilityStub = Spider.prototype[operation];
  return typeof implementation === 'function' && implementation !== compatibilityStub;
}
