import type { PreparedHtmlMediaSource } from './application/htmlMediaSource';
export type { PreparedHtmlMediaSource } from './application/htmlMediaSource';

export interface HtmlMediaPreparationPort {
  resolvePlayTarget(url: string): string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface HtmlPrepareResponse {
  url?: string;
  session?: string;
  width?: number;
  height?: number;
  error?: string;
}

/** Selects the small set of proxied cloud-drive URLs that need HTML playback preparation. */
export function needsHtmlMediaPreparation(url: string, port: Pick<HtmlMediaPreparationPort, 'resolvePlayTarget'>): boolean {
  const target = port.resolvePlayTarget(url).toLowerCase().split('?')[0];
  return /^http:\/\/127\.0\.0\.1:\d+\/play\?/.test(url)
    && /(?:baidu\.com|baidupcs\.com|quark\.cn|pds\.uc\.cn)/i.test(target)
    && !/\.m3u8(?:[?#]|$)/i.test(target);
}

/** Resolves the playable HTML media URL through the local compatibility endpoint when required. */
export async function prepareHtmlMediaSource(
  url: string,
  port: HtmlMediaPreparationPort,
  signal: AbortSignal,
): Promise<PreparedHtmlMediaSource> {
  if (!needsHtmlMediaPreparation(url, port)) return { source: url, url };

  const endpoint = new URL('/html/prepare', url);
  endpoint.searchParams.set('url', url);
  const response = await port.fetch(endpoint, { signal });
  const result = await response.json() as HtmlPrepareResponse;
  if (!response.ok || !result.url) throw new Error(result.error || '媒体兼容处理失败');

  return {
    source: url,
    url: result.url,
    width: result.width,
    height: result.height,
    ...(result.session ? { sessionReleaseUrl: new URL(`/html/${result.session}/release`, url).href } : {}),
  };
}

/** Releases a server-side transcode session without delaying playback teardown. */
export function releaseHtmlMediaSession(sessionReleaseUrl: string, port: Pick<HtmlMediaPreparationPort, 'fetch'>): void {
  void port.fetch(sessionReleaseUrl, { keepalive: true }).catch(() => undefined);
}
