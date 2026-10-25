import type { ServerResponse } from 'node:http';
import type { Dispatcher } from 'undici';

export interface ImageProxyResponse {
  statusCode: number;
  headers: Record<string, unknown>;
  body: {
    arrayBuffer(): Promise<ArrayBuffer>;
    dump(): Promise<unknown>;
  };
}

export interface ImageProxyPorts {
  dispatchers(targetUrl: string, domesticPoster: boolean): Dispatcher[];
  request(
    targetUrl: string,
    options: {
      method: 'GET';
      headers: Record<string, string>;
      headersTimeout: number;
      bodyTimeout: number;
      signal: AbortSignal;
      dispatcher: Dispatcher;
    },
  ): Promise<ImageProxyResponse>;
}

/** Owns external image fetching, anti-hotlink retries and response validation for `/img`. */
export class ImageProxyService {
  constructor(private readonly ports: ImageProxyPorts) {}

  async handle(url: URL, response: ServerResponse): Promise<void> {
    const target = url.searchParams.get('u') || '';
    const referer = url.searchParams.get('ref') || '';
    if (!/^https?:\/\//i.test(target)) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('bad request');
      return;
    }

    const referers: string[] = [];
    const addReferer = (value: string): void => { if (!referers.includes(value)) referers.push(value); };
    if (referer) addReferer(referer);
    const domesticPoster = /^https?:\/\/[^/]+\.doubanio\.com(?::\d+)?\//i.test(target);
    if (domesticPoster) addReferer('https://m.douban.com/');
    try { addReferer(new URL(target).origin + '/'); } catch { /* Invalid URLs are rejected above. */ }
    addReferer('');

    const clientAbort = new AbortController();
    response.once('close', () => { if (!response.writableEnded) clientAbort.abort(); });
    const signal = AbortSignal.any([clientAbort.signal, AbortSignal.timeout(30000)]);
    const dispatchers = this.ports.dispatchers(target, domesticPoster);
    for (const currentReferer of referers) {
      for (const dispatcher of dispatchers) {
        if (signal.aborted || response.destroyed) break;
        try {
          const headers: Record<string, string> = { accept: 'image/*', 'User-Agent': 'Mozilla/5.0 Win-Box/0.86' };
          if (currentReferer) headers.Referer = currentReferer;
          const upstream = await this.ports.request(target, {
            method: 'GET',
            headers,
            headersTimeout: 12000,
            bodyTimeout: 20000,
            signal,
            dispatcher,
          });
          const contentType = String(upstream.headers['content-type'] || '');
          const okStatus = upstream.statusCode === 200 || upstream.statusCode === 206;
          const looksImage = /^image\//i.test(contentType) || (/octet-stream/i.test(contentType) && okStatus);
          if (okStatus && looksImage) {
            const body = Buffer.from(await upstream.body.arrayBuffer());
            response.writeHead(200, {
              'Content-Type': /^image\//i.test(contentType) ? contentType : 'image/jpeg',
              'Cache-Control': 'public, max-age=86400',
            });
            response.end(body);
            return;
          }
          await upstream.body.dump().catch(() => undefined);
        } catch {
          // Try the next Referer or outbound DNS/proxy channel.
        }
      }
    }
    if (response.destroyed) return;
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('not found');
  }
}
