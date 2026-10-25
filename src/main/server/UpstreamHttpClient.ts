import type { Dispatcher } from 'undici';

export interface UpstreamHttpPorts {
  dispatchers(url: string): Dispatcher[];
  request(
    url: string,
    options: {
      method: 'GET';
      headers: Record<string, string>;
      headersTimeout: number;
      bodyTimeout: number;
      dispatcher: Dispatcher;
    },
  ): Promise<Dispatcher.ResponseData>;
}

export interface UpstreamStreamResponse {
  status: number;
  headers: Record<string, unknown>;
  body: Dispatcher.ResponseData['body'];
  finalUrl: string;
}

/** Shared HTTP boundary for streamed media and small redirected proxy responses. */
export class UpstreamHttpClient {
  constructor(private readonly ports: UpstreamHttpPorts) {}

  /** Follows redirects and returns an unread response stream plus its final URL. */
  async openStream(url: string, headers: Record<string, string>): Promise<UpstreamStreamResponse> {
    let currentUrl = url;
    for (let redirect = 0; redirect <= 10; redirect++) {
      let response: Dispatcher.ResponseData | undefined;
      let lastError: unknown;
      for (const dispatcher of this.ports.dispatchers(currentUrl)) {
        try {
          response = await this.ports.request(currentUrl, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 TVBoxWin/0.1', ...headers },
            headersTimeout: 30000,
            bodyTimeout: 0,
            dispatcher,
          });
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!response) throw lastError || new Error('upstream unavailable');
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location && redirect < 10) {
        currentUrl = new URL(Array.isArray(location) ? location[0] : location, currentUrl).toString();
        await response.body.dump().catch(() => undefined);
        continue;
      }
      return {
        status: response.statusCode || 200,
        headers: response.headers as Record<string, unknown>,
        body: response.body,
        finalUrl: currentUrl,
      };
    }
    throw new Error(`too many redirects: ${url}`);
  }

  /** Follows redirects and buffers the response for text/config routes. */
  async fetchWithRedirect(url: string, headers: Record<string, string>): Promise<{ status: number; contentType?: string; body: Buffer }> {
    let currentUrl = url;
    for (let redirect = 0; redirect <= 10; redirect++) {
      const dispatcher = this.ports.dispatchers(currentUrl)[0];
      if (!dispatcher) throw new Error('upstream dispatcher unavailable');
      const response = await this.ports.request(currentUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 TVBoxWin/0.1', ...headers },
        headersTimeout: 30000,
        bodyTimeout: 30000,
        dispatcher,
      });
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location && redirect < 10) {
        currentUrl = new URL(Array.isArray(location) ? location[0] : location, currentUrl).toString();
        await response.body.dump().catch(() => undefined);
        continue;
      }
      return {
        status: response.statusCode || 200,
        contentType: response.headers['content-type'] as string | undefined,
        body: Buffer.from(await response.body.arrayBuffer()),
      };
    }
    return { status: 0, body: Buffer.alloc(0) };
  }
}
