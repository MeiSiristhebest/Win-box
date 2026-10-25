// CMS source adapter: converts application source requests into CMS catalog calls.
import type { SourceBean, VodItem, VodDetail, PlayResult } from '../../shared/types';
import type { CmsCatalogPort, HomeResult, CategoryResult, SourceCatalogPort, SourcePlaybackPort } from './SourcePorts';
import { isPlaybackPageUrl } from '../../shared/playbackResult';
import { awaitWithAbort, throwIfAborted } from '../util/abort';

const CMS_SOURCE_TYPES = new Set([0, 1, 4]);

export class CmsSourceAdapter implements SourceCatalogPort, SourcePlaybackPort {
  constructor(private readonly catalog: CmsCatalogPort) {}

  supports(bean: SourceBean): boolean {
    return CMS_SOURCE_TYPES.has(bean.type);
  }

  async home(bean: SourceBean, timeoutMs = 20000): Promise<HomeResult> {
    const result = await this.catalog.home(bean.api, bean.type, bean.key, timeoutMs);
    return { ...result, sourceKey: bean.key };
  }

  async category(bean: SourceBean, tid: string, pg: string, extend: Record<string, string>, timeoutMs = 20000): Promise<CategoryResult> {
    const result = await this.catalog.category(bean.api, bean.type, bean.key, tid, pg, extend, timeoutMs);
    return { ...result, sourceKey: bean.key };
  }

  detail(bean: SourceBean, ids: string[], timeoutMs = 20000): Promise<VodDetail | null> {
    return this.catalog.detail(bean.api, bean.type, bean.key, ids, timeoutMs);
  }

  search(bean: SourceBean, wd: string, _quick: boolean, timeoutMs: number, signal?: AbortSignal): Promise<VodItem[]> {
    throwIfAborted(signal);
    return awaitWithAbort(this.catalog.search(bean.api, bean.type, bean.key, wd, timeoutMs, signal), signal);
  }

  async play(bean: SourceBean, flag: string, id: string, vipFlags: string[], _timeoutMs: number): Promise<PlayResult> {
    const playUrl = bean.playUrl || '';
    const url = playUrl.includes('{playUrl}') ? playUrl.replace('{playUrl}', id) : id;
    const needParse = vipFlags.includes(flag) || isPlaybackPageUrl(url) ? 1 : 0;
    return { parse: needParse, url, playUrl, flag };
  }
}
