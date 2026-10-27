// Spider source adapter: invokes supported source capabilities and normalizes results.
import type { SourceBean, VodItem, VodDetail, PlayResult } from '../../shared/types';
import type { CategoryResult, HomeResult, SpiderSourcePort } from './SourcePorts';
import type { SpiderSourceCapabilities, SpiderSourceProviderPort, SpiderSourceLogger } from './SpiderSourcePorts';
import { SpiderResultNormalizer } from './SpiderResultNormalizer';
import { SourceProblemError } from '../spider/errors';
import { SpiderHomeContentService } from './application/SpiderHomeContentService';
import { awaitWithAbort, throwIfAborted } from '../util/abort';

export class SpiderSourceAdapter implements SpiderSourcePort {
  private readonly normalizer = new SpiderResultNormalizer();
  private readonly homeContent: SpiderHomeContentService;
  supports(bean: SourceBean): boolean {
    return bean.type === 3;
  }

  constructor(
    private readonly spiders: SpiderSourceProviderPort,
    private readonly logger: SpiderSourceLogger,
  ) {
    this.homeContent = new SpiderHomeContentService(this.normalizer, logger, {
      now: () => Date.now(),
      within: (promise, timeoutMs, message) => this.withTimeout(promise, timeoutMs, message),
    });
  }

  async home(bean: SourceBean, timeoutMs: number, signal?: AbortSignal): Promise<HomeResult> {
    throwIfAborted(signal);
    return this.homeContent.load(bean.key, this.spiders.forSource(bean), timeoutMs, signal);
  }

  async category(bean: SourceBean, tid: string, pg: string, extend: Record<string, string>, timeoutMs = 20000, signal?: AbortSignal): Promise<CategoryResult> {
    throwIfAborted(signal);
    const sp = this.spiders.forSource(bean);
    const category = requireOperation(sp, 'categoryContent', bean.key);
    const budget = this.requestTimeout(timeoutMs);
    const json = await awaitWithAbort(this.withTimeout(
      Promise.resolve(category(tid, pg, true, extend, signal)),
      budget,
      `categoryContent 超时（>${budget}ms）`,
    ), signal);
    const reason = this.spiderReason(sp);
    if (reason && !this.normalizer.parseSpiderJson(json, bean.key)) throw new SourceProblemError('SPIDER_ERROR', reason);
    return this.normalizer.normalizeSpiderJson(json, bean.key, false);
  }

  async detail(bean: SourceBean, ids: string[], timeoutMs = 20000): Promise<VodDetail | null> {
    const sp = this.spiders.forSource(bean);
    const detail = requireOperation(sp, 'detailContent', bean.key);
    const budget = this.requestTimeout(timeoutMs);
    const json = await this.withTimeout(
      Promise.resolve(detail(ids)),
      budget,
      `detailContent 超时（>${budget}ms）`,
    );
    const reason = this.spiderReason(sp);
    if (reason && !this.normalizer.parseSpiderJson(json, bean.key)) throw new SourceProblemError('SPIDER_ERROR', reason);
    return this.normalizer.normalizeSpiderDetail(json);
  }

  async search(bean: SourceBean, wd: string, quick: boolean, budgetMs: number, signal?: AbortSignal): Promise<VodItem[]> {
    throwIfAborted(signal);
    const sp = this.spiders.forSource(bean);
    const search = requireOperation(sp, 'searchContent', bean.key);
    const json = await awaitWithAbort(Promise.resolve(search(wd, quick, budgetMs, signal)), signal);
    const reason = this.spiderReason(sp);
    if (reason && !this.normalizer.parseSpiderJson(json, bean.key)) throw new SourceProblemError('SPIDER_ERROR', reason);
    return this.normalizer.normalizeSpiderSearch(json, bean.key);
  }

  proxyPortFor(bean: SourceBean): number | null {
    if (bean.type !== 3) return null;
    return this.spiders.forSource(bean).proxyPort?.() ?? null;
  }

  async play(bean: SourceBean, flag: string, id: string, vipFlags: string[], timeoutMs: number): Promise<PlayResult> {
    const sp = this.spiders.forSource(bean);
    const play = requireOperation(sp, 'playerContent', bean.key);
    const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000;
    const json = await this.withTimeout(Promise.resolve(play(flag, id, vipFlags)), budget, 'playerContent 超时（' + budget + 'ms）');
    const result = this.normalizer.normalizeSpiderPlay(json, flag, bean.playUrl);
    const reason = !result.url && !result.message ? this.spiderReason(sp) : '';
    return reason ? { ...result, parse: 1, message: reason } : result;
  }

  /** 读取蜘蛛端最近一次失败原因（仅 jar 蜘蛛有；其它实现/无线索返回空串） */
  private spiderReason(sp: SpiderSourceCapabilities): string {
    try {
      return typeof sp.lastReason === 'string' ? sp.lastReason.trim() : '';
    } catch {
      return '';
    }
  }

  /** Promise 超时竞速（结束即清理定时器，避免悬挂 timer 拖住事件循环 / 测试） */
  private withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    });
    return Promise.race([p, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  private requestTimeout(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 20000;
  }


}

const OPERATION_LABELS = {
  homeContent: '首页',
  categoryContent: '分类浏览',
  detailContent: '影片详情',
  searchContent: '搜索',
  playerContent: '播放',
} as const;

type RequiredOperation = keyof typeof OPERATION_LABELS;

function unsupportedOperation(operation: RequiredOperation, sourceKey: string): SourceProblemError {
  return new SourceProblemError('OPERATION_UNSUPPORTED', `该源未提供${OPERATION_LABELS[operation]}功能`, { sourceKey, operation });
}

function requireOperation<K extends RequiredOperation>(
  capabilities: SpiderSourceCapabilities,
  operation: K,
  sourceKey: string,
): NonNullable<SpiderSourceCapabilities[K]> {
  const method = capabilities[operation];
  if (typeof method !== 'function') throw unsupportedOperation(operation, sourceKey);
  return method.bind(capabilities) as NonNullable<SpiderSourceCapabilities[K]>;
}
