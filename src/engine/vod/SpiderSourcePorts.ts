import type { Logger, SourceBean } from '../../shared/types';

type SpiderJson = string | Promise<string>;

/** Catalog protocol independent of runtime classes and host services. */
export interface SpiderCatalogCapabilities {
  homeContent(filter: boolean, signal?: AbortSignal): SpiderJson;
  homeVideoContent(signal?: AbortSignal): SpiderJson;
  categoryContent(tid: string, page: string, filter: boolean, extend: Record<string, string>, signal?: AbortSignal): SpiderJson;
  detailContent(ids: string[]): SpiderJson;
}

export interface SpiderSearchCapability {
  searchContent(keyword: string, quick: boolean, timeoutMs?: number, signal?: AbortSignal): SpiderJson;
}

export interface SpiderPlaybackCapability {
  playerContent(flag: string, id: string, vipFlags: string[]): SpiderJson;
}

export interface SpiderProxyCapability {
  proxyPort(): number | null;
}

/** Only implemented operations are exposed; absence differs from a legal empty result. */
export interface SpiderSourceCapabilities extends
  Partial<SpiderCatalogCapabilities>,
  Partial<SpiderSearchCapability>,
  Partial<SpiderPlaybackCapability>,
  Partial<SpiderProxyCapability> {
  readonly lastReason?: string;
}

export interface SpiderSourceProviderPort {
  forSource(source: SourceBean): SpiderSourceCapabilities;
}

export type SpiderSourceLogger = Pick<Logger, 'i' | 'w'>;
