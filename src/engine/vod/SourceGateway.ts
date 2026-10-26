// SourceGateway routes use cases to the registered adapter that supports a source.
import type { SourceBean, VodItem, VodDetail, PlayResult } from '../../shared/types';
import type { SourceAdapterIdentity, SourceAdapterRegistry, SourceGatewayLogger, HomeResult, CategoryResult, SourceQueryGatewayPort } from './SourcePorts';
import { SourceProblemError, SOURCE_PROBLEM_TEXT } from '../spider/errors';
import { sourceAvailability, type SourceAvailability } from './sourceAvailability';
import { sourceSearchBudgetMs } from '../spider/sourceTimeout';
import { sourceRequestTimeoutMs } from './sourceTimeout';
import { awaitWithAbort, throwIfAborted } from '../util/abort';

export { sourceAvailability, type SourceAvailability };
export { sourceSearchBudgetMs } from '../spider/sourceTimeout';
export type { CmsCatalogPort, CategoryResult, HomeResult, SourceCatalogResult, SpiderSourcePort, SourceAdapterRegistry, SourceCatalogPort, SourcePlaybackPort, SourceProxyPort, SourceQueryGatewayPort } from './SourcePorts';

/** Coordinates source use cases. New source types are added by registering focused adapters. */
export class SourceGateway implements SourceQueryGatewayPort {
  constructor(
    private readonly adapters: SourceAdapterRegistry,
    private readonly logger: SourceGatewayLogger,
  ) {}

  private adapterFor<T extends SourceAdapterIdentity>(adapters: readonly T[], bean: SourceBean, operation: string): T {
    const adapter = adapters.find((candidate) => candidate.supports(bean));
    if (adapter) return adapter;
    const availability = sourceAvailability(bean);
    this.logger.w('source-gateway:' + operation + ' type=' + bean.type + ' is unavailable on desktop (' + bean.key + ')');
    throw new SourceProblemError(
      'TYPE_UNSUPPORTED',
      availability.hint ?? SOURCE_PROBLEM_TEXT.TYPE_UNSUPPORTED,
      { sourceKey: bean.key, type: bean.type },
    );
  }

  async home(bean: SourceBean, timeoutMs = 20000): Promise<HomeResult> {
    return this.adapterFor(this.adapters.catalog, bean, 'home').home(bean, sourceRequestTimeoutMs(bean, timeoutMs));
  }

  async category(bean: SourceBean, tid: string, pg: string, extend: Record<string, string>, timeoutMs = 20000): Promise<CategoryResult> {
    return this.adapterFor(this.adapters.catalog, bean, 'category').category(bean, tid, pg, extend, sourceRequestTimeoutMs(bean, timeoutMs));
  }

  async detail(bean: SourceBean, ids: string[], timeoutMs = 20000): Promise<VodDetail | null> {
    return this.adapterFor(this.adapters.catalog, bean, 'detail').detail(bean, ids, sourceRequestTimeoutMs(bean, timeoutMs));
  }

  async search(bean: SourceBean, wd: string, signal?: AbortSignal): Promise<VodItem[]>;
  async search(bean: SourceBean, wd: string, quick: boolean, timeoutMs?: number, signal?: AbortSignal): Promise<VodItem[]>;
  async search(
    bean: SourceBean,
    wd: string,
    quickOrSignal: boolean | AbortSignal = false,
    timeoutMs?: number,
    legacySignal?: AbortSignal,
  ): Promise<VodItem[]> {
    const quick = typeof quickOrSignal === 'boolean' ? quickOrSignal : false;
    const signal = typeof quickOrSignal === 'boolean' ? legacySignal : quickOrSignal;
    throwIfAborted(signal);
    const budgetMs = sourceSearchBudgetMs(bean, timeoutMs);
    const search = this.adapterFor(this.adapters.catalog, bean, 'search').search(bean, wd, quick, budgetMs, signal);
    return awaitWithAbort(search, signal);
  }

  proxyPortFor(bean: SourceBean): number | null {
    const adapter = this.adapters.proxy.find((candidate) => candidate.supports(bean));
    return adapter?.proxyPortFor(bean) ?? null;
  }

  async play(bean: SourceBean, flag: string, id: string, vipFlags: string[], timeoutMs = 20000): Promise<PlayResult> {
    return this.adapterFor(this.adapters.playback, bean, 'play').play(bean, flag, id, vipFlags, timeoutMs);
  }
}
