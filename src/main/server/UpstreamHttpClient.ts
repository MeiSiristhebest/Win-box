import type { Dispatcher } from 'undici';
import { HttpRequestError } from '../../shared/HttpRequestError';

export const DEFAULT_BUFFERED_UPSTREAM_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_BUFFERED_UPSTREAM_TIMEOUT_MS = 30_000;
export const MAX_BUFFERED_UPSTREAM_RESPONSE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_HLS_MANIFEST_BYTES = 8 * 1024 * 1024;
export const HLS_MANIFEST_TOTAL_TIMEOUT_MS = 30_000;

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
      signal?: AbortSignal;
    },
  ): Promise<Dispatcher.ResponseData>;
}

export interface UpstreamResponseOptions {
  /** Wire-byte cap. Defaults to 8 MiB and has a 64 MiB hard ceiling. */
  maxResponseBytes?: number;
  /** Total deadline across redirects and body reads; defaults to 30 seconds. */
  totalTimeoutMs?: number;
  /** Cancels dispatch, redirect draining, and body iteration. */
  signal?: AbortSignal;
  /** Progress in wire bytes; observer exceptions are ignored. */
  onProgress?: (loadedBytes: number, totalBytes?: number) => void;
}

export interface UpstreamStreamResponse {
  status: number;
  headers: Record<string, unknown>;
  body: Dispatcher.ResponseData['body'];
  finalUrl: string;
}

interface RequestBudget {
  signal: AbortSignal;
  failure(): HttpRequestError | undefined;
  abort(error: HttpRequestError): void;
  dispose(): void;
}

function contentLength(headers: Record<string, unknown>): number | undefined {
  const raw = headers['content-length'] ?? headers['Content-Length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

function stopBody(body: Dispatcher.ResponseData['body']): void {
  body.on('error', () => undefined);
  body.destroy();
}

function notifyProgress(callback: UpstreamResponseOptions['onProgress'], loadedBytes: number, totalBytes?: number): void {
  try { callback?.(loadedBytes, totalBytes); } catch { /* progress observers cannot fail transport */ }
}

function resolveResponseLimit(value: number | undefined): number {
  const max = value ?? DEFAULT_BUFFERED_UPSTREAM_RESPONSE_BYTES;
  if (!Number.isSafeInteger(max) || max < 0 || max > MAX_BUFFERED_UPSTREAM_RESPONSE_BYTES) {
    throw new HttpRequestError('HTTP_INVALID_RESPONSE_LIMIT', `响应字节上限必须是 0 到 ${MAX_BUFFERED_UPSTREAM_RESPONSE_BYTES} 的整数`);
  }
  return max;
}

function resolveTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : DEFAULT_BUFFERED_UPSTREAM_TIMEOUT_MS;
}

function abortError(signal: AbortSignal): HttpRequestError {
  return signal.reason instanceof HttpRequestError
    ? signal.reason
    : new HttpRequestError('HTTP_CANCELLED', '请求已取消');
}

function waitForSignal<T>(promise: Promise<T>, budget: RequestBudget): Promise<T> {
  if (budget.signal.aborted) return Promise.reject(budget.failure() ?? abortError(budget.signal));
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => budget.signal.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      cleanup();
      reject(budget.failure() ?? abortError(budget.signal));
    };
    budget.signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

/** Shared HTTP boundary for streamed media and small redirected proxy responses. */
export class UpstreamHttpClient {
  constructor(private readonly ports: UpstreamHttpPorts) {}

  private createBudget(options: UpstreamResponseOptions = {}): RequestBudget {
    const controller = new AbortController();
    const timeoutMs = resolveTimeout(options.totalTimeoutMs);
    let failure: HttpRequestError | undefined;
    const abort = (error: HttpRequestError): void => {
      if (controller.signal.aborted) return;
      failure = error;
      controller.abort(error);
    };
    const parentAbort = (): void => abort(abortError(options.signal!));
    if (options.signal?.aborted) parentAbort();
    else options.signal?.addEventListener('abort', parentAbort, { once: true });
    const timer = setTimeout(() => {
      abort(new HttpRequestError('HTTP_TOTAL_TIMEOUT', `请求总超时（${timeoutMs}ms）`));
    }, timeoutMs);
    return {
      signal: controller.signal,
      failure: () => failure,
      abort,
      dispose: () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', parentAbort);
      },
    };
  }

  private throwIfAborted(budget: RequestBudget): void {
    if (budget.signal.aborted) throw budget.failure() ?? abortError(budget.signal);
  }

  private async readBoundedBody(
    body: Dispatcher.ResponseData['body'],
    maxBytes: number,
    signal: AbortSignal,
    budget: RequestBudget,
    totalBytes?: number,
    onProgress?: UpstreamResponseOptions['onProgress'],
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let loaded = 0;
    notifyProgress(onProgress, 0, totalBytes);
    const iterator = body[Symbol.asyncIterator]();
    try {
      for (;;) {
        this.throwIfAborted(budget);
        const next = await waitForSignal(Promise.resolve(iterator.next()) as Promise<IteratorResult<Buffer>>, budget);
        if (next.done) break;
        const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value as unknown as Uint8Array);
        if (loaded + chunk.byteLength > maxBytes) {
          stopBody(body);
          throw new HttpRequestError('HTTP_RESPONSE_TOO_LARGE', `响应超过字节上限（${maxBytes}）`);
        }
        chunks.push(chunk);
        loaded += chunk.byteLength;
        notifyProgress(onProgress, loaded, totalBytes);
      }
      return Buffer.concat(chunks, loaded);
    } catch (error) {
      stopBody(body);
      if (error instanceof HttpRequestError) throw error;
      if (budget.signal.aborted) throw budget.failure() ?? abortError(budget.signal);
      throw error;
    }
  }

  /** Follows redirects and returns an unread response stream plus its final URL. */
  async openStream(url: string, headers: Record<string, string>, options: Pick<UpstreamResponseOptions, 'signal'> = {}): Promise<UpstreamStreamResponse> {
    let currentUrl = url;
    for (let redirect = 0; redirect <= 10; redirect++) {
      if (options.signal?.aborted) throw abortError(options.signal);
      let response: Dispatcher.ResponseData | undefined;
      let lastError: unknown;
      for (const dispatcher of this.ports.dispatchers(currentUrl)) {
        if (options.signal?.aborted) throw abortError(options.signal);
        try {
          response = await this.ports.request(currentUrl, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 TVBoxWin/0.1', ...headers },
            headersTimeout: 30000,
            bodyTimeout: 0,
            dispatcher,
            ...(options.signal ? { signal: options.signal } : {}),
          });
          break;
        } catch (error) {
          if (options.signal?.aborted) throw abortError(options.signal);
          lastError = error;
        }
      }
      if (!response) throw lastError || new Error('upstream unavailable');
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location && redirect < 10) {
        currentUrl = new URL(Array.isArray(location) ? location[0] : location, currentUrl).toString();
        // Redirect bodies are discarded instead of drained without a deadline; they are never surfaced.
        stopBody(response.body);
        continue;
      }
      return {
        status: response.statusCode,
        headers: response.headers as Record<string, unknown>,
        body: response.body,
        finalUrl: currentUrl,
      };
    }
    throw new Error(`too many redirects: ${url}`);
  }

  /** Follows redirects and buffers the response for text/config routes. */
  async fetchWithRedirect(
    url: string,
    headers: Record<string, string>,
    options: UpstreamResponseOptions = {},
  ): Promise<{ status: number; contentType?: string; body: Buffer }> {
    const maxBytes = resolveResponseLimit(options.maxResponseBytes);
    const budget = this.createBudget(options);
    let currentUrl = url;
    try {
      for (let redirect = 0; redirect <= 10; redirect++) {
        this.throwIfAborted(budget);
        const dispatcher = this.ports.dispatchers(currentUrl)[0];
        if (!dispatcher) throw new Error('upstream dispatcher unavailable');
        const response = await waitForSignal(this.ports.request(currentUrl, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 TVBoxWin/0.1', ...headers },
          headersTimeout: Math.min(30000, resolveTimeout(options.totalTimeoutMs)),
          bodyTimeout: Math.min(30000, resolveTimeout(options.totalTimeoutMs)),
          dispatcher,
          signal: budget.signal,
        }), budget);
        const location = response.headers.location;
        if (response.statusCode >= 300 && response.statusCode < 400 && location && redirect < 10) {
          currentUrl = new URL(Array.isArray(location) ? location[0] : location, currentUrl).toString();
          await waitForSignal(response.body.dump(), budget).catch((error) => {
            if (budget.signal.aborted) throw error;
          });
          continue;
        }
        const declaredLength = contentLength(response.headers as Record<string, unknown>);
        if (declaredLength !== undefined && declaredLength > maxBytes) {
          notifyProgress(options.onProgress, 0, declaredLength);
          stopBody(response.body);
          throw new HttpRequestError('HTTP_RESPONSE_TOO_LARGE', `响应超过字节上限（${maxBytes}）`);
        }
        const body = await this.readBoundedBody(response.body, maxBytes, budget.signal, budget, declaredLength, options.onProgress);
        return {
          status: response.statusCode,
          contentType: response.headers['content-type'] as string | undefined,
          body,
        };
      }
      throw new HttpRequestError('HTTP_INVALID_MANIFEST', `重定向超过上限：${url}`);
    } finally {
      budget.dispose();
    }
  }

  /** Bounded body reader for a manifest already classified from response metadata. */
  async readBufferedBody(
    body: Dispatcher.ResponseData['body'],
    options: UpstreamResponseOptions & { contentLength?: number } = {},
  ): Promise<Buffer> {
    const maxBytes = resolveResponseLimit(options.maxResponseBytes ?? DEFAULT_HLS_MANIFEST_BYTES);
    const budget = this.createBudget(options);
    try {
      const declaredLength = options.contentLength;
      if (declaredLength !== undefined && declaredLength > maxBytes) {
        notifyProgress(options.onProgress, 0, declaredLength);
        stopBody(body);
        throw new HttpRequestError('HTTP_RESPONSE_TOO_LARGE', `清单超过字节上限（${maxBytes}）`);
      }
      return await this.readBoundedBody(body, maxBytes, budget.signal, budget, declaredLength, options.onProgress);
    } finally {
      budget.dispose();
    }
  }
}
