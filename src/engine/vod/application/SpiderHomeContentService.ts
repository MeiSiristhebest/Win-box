import type { HomeResult } from '../SourcePorts';
import type { SpiderSourceLogger } from '../SpiderSourcePorts';
import { SpiderResultNormalizer, PAGE_ITEMS_ONE_PAGE } from '../SpiderResultNormalizer';
import { SOURCE_PROBLEM_TEXT, SourceProblemError } from '../../spider/errors';
import { abortError, awaitWithAbort, throwIfAborted } from '../../util/abort';

/** The catalog operations needed to build a spider-backed home page. */
export interface SpiderHomeContentPort {
  homeContent?: (filter: boolean, signal?: AbortSignal) => string | Promise<string>;
  homeVideoContent?: (signal?: AbortSignal) => string | Promise<string>;
  categoryContent?: (tid: string, page: string, filter: boolean, extend: Record<string, string>, signal?: AbortSignal) => string | Promise<string>;
  readonly lastReason?: string;
}

/** Time and timeout effects are supplied by the outer runtime adapter. */
export interface SpiderHomeDeadlinePort {
  now(): number;
  within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T>;
}

type ParsedCatalog = NonNullable<ReturnType<SpiderResultNormalizer['parseSpiderJson']>>;
type ClassRecommendation = Pick<ParsedCatalog, 'items' | 'page' | 'pagecount' | 'total'>;

/**
 * Applies the catalog fallback policy for a spider home page.
 * SpiderSourceAdapter stays responsible for protocol adaptation; this service
 * owns the user-facing choice between home, recommendation, and first category.
 */
export class SpiderHomeContentService {
  constructor(
    private readonly normalizer: SpiderResultNormalizer,
    private readonly logger: SpiderSourceLogger,
    private readonly deadline: SpiderHomeDeadlinePort,
  ) {}

  async load(sourceKey: string, spider: SpiderHomeContentPort, timeoutMs: number, signal?: AbortSignal): Promise<HomeResult> {
    throwIfAborted(signal);
    if (!spider.homeContent && !spider.homeVideoContent) {
      throw unsupportedHome(sourceKey);
    }

    const budgetMs = requestTimeout(timeoutMs);
    const deadline = this.deadline.now() + budgetMs;
    let homeJson = '';
    let homeFailure: SourceProblemError | null = null;
    try {
      if (spider.homeContent) {
        homeJson = await awaitWithAbort(this.deadline.within(
          Promise.resolve(spider.homeContent(true, signal)),
          Math.max(200, deadline - this.deadline.now()),
          `homeContent 超时（>${budgetMs}ms）`,
        ), signal);
      }
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      // Invocation failures can recover through recommendations. Preparation and
      // unsupported-runtime failures have no homeContent operation identity.
      if (!isHomeInvocationFailure(error)) throw error;
      homeFailure = error;
    }

    const parsed = this.normalizer.parseSpiderJson(homeJson, sourceKey);
    let contentNotice = homeFailure?.message ?? (!parsed ? spiderReason(spider) : '');
    const onNotice = (message: string) => { contentNotice = message; };

    // A full first page is authoritative; don't replace it with a fallback.
    if (parsed && parsed.items.length >= PAGE_ITEMS_ONE_PAGE) {
      return {
        sortClasses: parsed.classes,
        items: parsed.items,
        page: parsed.page,
        pagecount: parsed.pagecount,
        total: parsed.total,
        sourceKey,
      };
    }

    const baseItems = parsed?.items ?? [];
    const recItems = await this.tryHomeRecommendation(spider, sourceKey, deadline, onNotice, signal);
    const classes = parsed?.classes ?? [];
    // Prefer a fallback only when it gives the user more results.
    let items = recItems.length > baseItems.length ? recItems : baseItems;
    let fallbackKind: 'recommendation' | 'category' | '' = recItems.length > baseItems.length ? 'recommendation' : '';

    let categoryPage: ClassRecommendation | null = null;
    if (items.length < PAGE_ITEMS_ONE_PAGE && classes.length > 0) {
      const firstClass = classes[0];
      if (firstClass) {
        const recommendation = await this.tryFirstCategory(spider, sourceKey, firstClass.id, deadline, onNotice, signal);
        if (recommendation && recommendation.items.length > items.length) {
          items = recommendation.items;
          categoryPage = recommendation;
          fallbackKind = 'category';
        }
      }
    }

    if (classes.length === 0 && items.length === 0) {
      if (homeFailure) throw homeFailure;
      const reason = spiderReason(spider);
      if (!parsed) throw new SourceProblemError('SPIDER_ERROR', reason || SOURCE_PROBLEM_TEXT.SPIDER_ERROR);
      throw new SourceProblemError('EMPTY_RESULT', reason || SOURCE_PROBLEM_TEXT.EMPTY_RESULT);
    }

    return {
      sortClasses: classes,
      items,
      page: categoryPage?.page ?? parsed?.page ?? 0,
      pagecount: categoryPage?.pagecount ?? parsed?.pagecount ?? 0,
      total: categoryPage?.total ?? (items.length || (parsed?.total ?? 0)),
      sourceKey,
      ...(fallbackKind ? { homeFallback: true } : {}),
      ...(items.length === 0 && contentNotice ? { contentNotice } : {}),
    };
  }

  private async tryFirstCategory(
    spider: SpiderHomeContentPort,
    sourceKey: string,
    typeId: string,
    deadline: number,
    onNotice: (message: string) => void,
    signal?: AbortSignal,
  ): Promise<ClassRecommendation | null> {
    if (!spider.categoryContent) return null;
    try {
      const json = await awaitWithAbort(this.deadline.within(
        Promise.resolve(spider.categoryContent(typeId, '1', true, {}, signal)),
        Math.max(200, deadline - this.deadline.now()),
        'homeContent 分类兜底超时',
      ), signal);
      const result = this.normalizer.parseSpiderJson(json, sourceKey);
      onNotice(result ? '' : spiderReason(spider));
      if (!result || result.items.length === 0) {
        this.logger.i(`vm:home type3 ${sourceKey} 分类兜底（tid=${typeId}）无数据`);
        return null;
      }
      this.logger.i(`vm:home type3 ${sourceKey} 已用分类兜底（tid=${typeId}）取到 ${result.items.length} 条`);
      return {
        items: result.items,
        page: result.page || 1,
        pagecount: result.pagecount || 1,
        total: result.total || result.items.length,
      };
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const message = errorMessage(error);
      this.logger.w(`vm:home type3 ${sourceKey} 分类兜底失败: ${message}`);
      onNotice(message);
      return null;
    }
  }

  private async tryHomeRecommendation(
    spider: SpiderHomeContentPort,
    sourceKey: string,
    deadline: number,
    onNotice: (message: string) => void,
    signal?: AbortSignal,
  ): Promise<ParsedCatalog['items']> {
    if (!spider.homeVideoContent) return [];
    try {
      const json = await awaitWithAbort(this.deadline.within(
        Promise.resolve(spider.homeVideoContent(signal)),
        Math.max(200, deadline - this.deadline.now()),
        'homeVideoContent 回退超时',
      ), signal);
      const result = this.normalizer.parseSpiderJson(json, sourceKey);
      onNotice(result ? '' : spiderReason(spider));
      if (!result || result.items.length === 0) {
        this.logger.i(`vm:home type3 ${sourceKey} homeVideoContent 无数据`);
        return [];
      }
      this.logger.i(`vm:home type3 ${sourceKey} 已用 homeVideoContent 回退 ${result.items.length} 条`);
      return result.items;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const message = errorMessage(error);
      this.logger.w(`vm:home type3 ${sourceKey} homeVideoContent 回退失败: ${message}`);
      onNotice(message);
      return [];
    }
  }
}

function isHomeInvocationFailure(error: unknown): error is SourceProblemError {
  if (!(error instanceof SourceProblemError) || !error.detail || typeof error.detail !== 'object') return false;
  return 'operation' in error.detail && error.detail.operation === 'homeContent';
}

function spiderReason(spider: SpiderHomeContentPort): string {
  try {
    return typeof spider.lastReason === 'string' ? spider.lastReason.trim() : '';
  } catch {
    return '';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestTimeout(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 20000;
}

function unsupportedHome(sourceKey: string): SourceProblemError {
  return new SourceProblemError('OPERATION_UNSUPPORTED', '该源未提供首页功能', { sourceKey, operation: 'homeContent' });
}
