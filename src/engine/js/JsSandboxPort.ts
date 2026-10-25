import type { HttpClient, HttpRequest, HttpResponse, KVStore, Logger } from '../../shared/types';

/** Runtime flavor selected after a script's export object is loaded. */
export type SpiderStyle = 'hiker' | 'drpy' | 'unknown';

/** Host capabilities consumed by the JS spider runtime and its global adapters. */
export interface JsSandboxHostPort {
  http: HttpClient;
  httpSync?: (request: HttpRequest) => HttpResponse;
  kv: KVStore;
  logger: Logger;
  proxyBase?: string;
  jsLibDir?: string;
}

/** Runtime contract owned by JsSpider; in-process and worker implementations satisfy it. */
export interface JsSpiderRuntimePort {
  readonly siteKey: string;
  readonly spiderStyle: SpiderStyle;
  setExt(ext: string): void;
  ensureLoaded(signal?: AbortSignal): Promise<void>;
  callMethod(names: string[], args: unknown[], timeoutMs: number, signal?: AbortSignal): Promise<unknown>;
  destroy(): void;
}

