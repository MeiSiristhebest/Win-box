import type { Logger, SourceBean, VodDetail, VodItem, PlayResult } from '../../shared/types';
import type { SortClass } from '../parse/Movie';
export interface SourceCatalogResult {
  sortClasses: SortClass[];
  items: VodItem[];
  page: number;
  pagecount: number;
  total: number;
  homeFallback?: boolean;
}

export interface HomeResult extends SourceCatalogResult {
  sourceKey: string;
  contentNotice?: string;
}

export interface CategoryResult extends SourceCatalogResult {
  sourceKey: string;
}

export interface CmsCatalogPort {
  home(api: string, type: number, sourceKey: string, timeoutMs?: number): Promise<SourceCatalogResult>;
  category(api: string, type: number, sourceKey: string, tid: string, pg: string, extend: Record<string, string>, timeoutMs?: number): Promise<SourceCatalogResult>;
  detail(api: string, type: number, sourceKey: string, ids: string[], timeoutMs?: number): Promise<VodDetail | null>;
  search(api: string, type: number, sourceKey: string, wd: string, timeoutMs?: number, signal?: AbortSignal): Promise<VodItem[]>;
}

export interface SourceAdapterIdentity {
  supports(bean: SourceBean): boolean;
}

export interface SourceCatalogPort extends SourceAdapterIdentity {
  home(bean: SourceBean, timeoutMs: number): Promise<HomeResult>;
  category(bean: SourceBean, tid: string, pg: string, extend: Record<string, string>, timeoutMs: number): Promise<CategoryResult>;
  detail(bean: SourceBean, ids: string[], timeoutMs: number): Promise<VodDetail | null>;
  search(bean: SourceBean, wd: string, quick: boolean, budgetMs: number, signal?: AbortSignal): Promise<VodItem[]>;
}

/** Application-facing query surface; source selection stays behind the gateway port. */
export interface SourceQueryGatewayPort {
  home(bean: SourceBean): Promise<HomeResult>;
  category(bean: SourceBean, tid: string, pg: string, extend: Record<string, string>): Promise<CategoryResult>;
  detail(bean: SourceBean, ids: string[]): Promise<VodDetail | null>;
  search(bean: SourceBean, wd: string): Promise<VodItem[]>;
}

export interface SourcePlaybackPort extends SourceAdapterIdentity {
  play(bean: SourceBean, flag: string, id: string, vipFlags: string[], timeoutMs: number): Promise<PlayResult>;
}

export interface SourceProxyPort extends SourceAdapterIdentity {
  proxyPortFor(bean: SourceBean): number | null;
}

export type SpiderSourcePort = SourceCatalogPort & SourcePlaybackPort & SourceProxyPort;

export interface SourceAdapterRegistry {
  catalog: readonly SourceCatalogPort[];
  playback: readonly SourcePlaybackPort[];
  proxy: readonly SourceProxyPort[];
}

export type SourceGatewayLogger = Pick<Logger, 'w'>;
