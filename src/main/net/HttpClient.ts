// src/main/net/HttpClient.ts — undici 实现 engine/ports 的 HttpClient
// 自定义 UA/Referer/Header/超时/重定向/charset 解码。Electron 主进程发请求绕过 CORS。
// ★ undici v7 不再支持 request({maxRedirections})，改为手动跟随 Location（版本无关、可靠）。
import { request as undiciRequest, Agent } from 'undici';
import type { Dispatcher } from 'undici';
import * as iconv from 'iconv-lite';
import { createDohAgent } from './DnsResolver';
import { dispatchChain } from './proxy';
import { HttpRequestError } from '../../shared/HttpRequestError';
import type {
  HttpClient as IHttpClient,
  HttpRequest,
  HttpResponse,
} from '../../shared/types';

const agent = new Agent({ connect: { timeout: 30000 } });
export const DEFAULT_HTTP_TEXT_RESPONSE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_HTTP_BYTE_ARRAY_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_HTTP_BASE64_RESPONSE_BYTES = 32 * 1024 * 1024;
export const MAX_HTTP_RESPONSE_BYTES = 256 * 1024 * 1024;
const DEFAULT_HTTP_TOTAL_TIMEOUT_MS = 30_000;
/**
 * ★ 2026-09-25：DoH 解析专用的 Agent（`HttpRequest.doh = 1` 时启用）。
 *   用途：**域名被 DNS 污染**的站点 —— 系统 DNS 会解到劫持 IP（返回运营商反诈页/假页面），
 *   表现为「订阅不是有效的 JSON」「源请求解析失败」，而 DoH 能拿到真实 IP 直连。
 *   懒创建：不发起 DoH 请求时零开销。
 */
let dohAgent: Agent | null = null;
function dohDispatcher(): Agent {
  if (!dohAgent) dohAgent = createDohAgent();
  return dohAgent;
}

function decodeCharset(buffer: Buffer, charset?: string): string {
  const cs = (charset || '').toLowerCase();
  if (cs === 'gbk' || cs === 'gb2312' || cs === 'gb18030') {
    return iconv.decode(buffer, 'gb18030');
  }
  if (cs && cs !== 'utf-8' && cs !== 'utf8') {
    try { return iconv.decode(buffer, cs); } catch { /* fallback */ }
  }
  return buffer.toString('utf-8');
}

function responseLength(headers: Record<string, unknown>): number | undefined {
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

function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof HttpRequestError
    ? signal.reason
    : new HttpRequestError('HTTP_CANCELLED', '请求已取消');
}

function notifyProgress(onProgress: HttpRequest['onProgress'], loaded: number, total?: number): void {
  try { onProgress?.(loaded, total); } catch { /* progress observers cannot fail a network request */ }
}

async function readResponseBody(
  body: Dispatcher.ResponseData['body'],
  maxBytes: number,
  signal: AbortSignal,
  onProgress: HttpRequest['onProgress'],
  totalBytes?: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let loaded = 0;
  notifyProgress(onProgress, 0, totalBytes);

  const iterator = body[Symbol.asyncIterator]();
  const awaitNext = (next: Promise<IteratorResult<Buffer>>): Promise<IteratorResult<Buffer>> => {
    if (signal.aborted) return Promise.reject(cancellationError(signal));
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        reject(cancellationError(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      next.then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
        (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  };

  try {
    for (;;) {
      const next = await awaitNext(iterator.next() as Promise<IteratorResult<Buffer>>);
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
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    if (signal.aborted) {
      stopBody(body);
      throw signal.reason ?? new HttpRequestError('HTTP_CANCELLED', '请求已取消');
    }
    throw error;
  }
  return Buffer.concat(chunks, loaded);
}

export class HttpClient implements IHttpClient {
  async request(req: HttpRequest): Promise<HttpResponse> {
    if (req.signal?.aborted) throw cancellationError(req.signal);
    const defaultResponseLimit = req.buffer === 1
      ? DEFAULT_HTTP_BYTE_ARRAY_RESPONSE_BYTES
      : req.buffer === 2 ? DEFAULT_HTTP_BASE64_RESPONSE_BYTES : DEFAULT_HTTP_TEXT_RESPONSE_BYTES;
    const maxResponseBytes = req.maxResponseBytes ?? defaultResponseLimit;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0 || maxResponseBytes > MAX_HTTP_RESPONSE_BYTES) {
      throw new HttpRequestError('HTTP_INVALID_RESPONSE_LIMIT', `响应字节上限必须是 0 到 ${MAX_HTTP_RESPONSE_BYTES} 的整数`);
    }
    const method = (req.method || 'get').toUpperCase();
    const headers: Record<string, string> = { ...req.headers };
    if (!headers['User-Agent'] && !headers['user-agent']) {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TVBoxWin/0.1';
    }
    let body: string | Buffer | undefined;
    if (req.body != null) {
      body = req.body;
    } else if (req.data != null) {
      const ct = req.postType;
      if (ct === 'json') {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        body = typeof req.data === 'string' ? req.data : JSON.stringify(req.data);
      } else if (ct === 'form') {
        headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
        body = new URLSearchParams(req.data as Record<string, string>).toString();
      } else {
        body = String(req.data);
      }
    }

    const maxRedir = req.redirect === 0 ? 0 : 10;
    const totalTimeoutMs = Number.isSafeInteger(req.totalTimeoutMs) && (req.totalTimeoutMs ?? 0) > 0
      ? req.totalTimeoutMs!
      : Number.isSafeInteger(req.timeoutMs) && (req.timeoutMs ?? 0) > 0
        ? req.timeoutMs!
        : DEFAULT_HTTP_TOTAL_TIMEOUT_MS;
    const deadline = Date.now() + totalTimeoutMs;
    // 出站链：用户设的**网络代理**（非本机目标）优先，其次 DoH（req.doh），最后直连
    const dispatcher = dispatchChain(req.url, req.doh ? dohDispatcher() : agent)[0];
    let url = req.url;
    let finalUrl = url;
    for (let i = 0; i <= maxRedir; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new HttpRequestError('HTTP_TOTAL_TIMEOUT', `请求总超时（${totalTimeoutMs}ms）`);
      const phaseTimeout = req.timeoutMs || 30000;
      const requestTimeout = Math.min(phaseTimeout, remaining);
      const controller = new AbortController();
      const signal = req.signal ? AbortSignal.any([controller.signal, req.signal]) : controller.signal;
      let deadlineExpired = false;
      const timer = setTimeout(() => {
        deadlineExpired = true;
        controller.abort(new HttpRequestError('HTTP_TOTAL_TIMEOUT', `请求总超时（${totalTimeoutMs}ms）`));
      }, remaining);
      try {
        const r = await undiciRequest(url, {
          method,
          headers,
          body: body as any,
          headersTimeout: requestTimeout,
          bodyTimeout: requestTimeout,
          dispatcher,
          signal,
        });
        const loc = r.headers['location'];
        if (r.statusCode >= 300 && r.statusCode < 400 && loc && i < maxRedir && method !== 'HEAD') {
          // 跟随重定向（GET/HEAD 不重发 body）
          url = new URL(Array.isArray(loc) ? loc[0] : loc, url).toString();
          finalUrl = url;
          // Redirect bodies are never exposed. Drain under the same total deadline before the next hop.
          await r.body.dump().catch(() => undefined);
          if (signal.aborted) throw signal.reason ?? new HttpRequestError('HTTP_CANCELLED', '请求已取消');
          // 重定向后通常不带 body
          if (method === 'POST') { /* 保留 body */ }
          continue;
        }
        const contentLength = responseLength(r.headers as Record<string, unknown>);
        if (contentLength !== undefined && contentLength > maxResponseBytes) {
          notifyProgress(req.onProgress, 0, contentLength);
          stopBody(r.body);
          throw new HttpRequestError('HTTP_RESPONSE_TOO_LARGE', `响应超过字节上限（${maxResponseBytes}）`);
        }
        const buf = await readResponseBody(r.body, maxResponseBytes, signal, req.onProgress, contentLength);
        const respHeaders: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(r.headers)) {
          respHeaders[k] = v as string | string[];
        }
        const charset = (req.charset || decodeCharsetGuess(r.headers['content-type'] as string));

        let content: string | number[];
        if (req.buffer === 1) {
          content = Array.from(buf);
        } else if (req.buffer === 2) {
          content = buf.toString('base64');
        } else {
          content = decodeCharset(buf, charset);
        }
        return { status: r.statusCode, headers: respHeaders, content, finalUrl };
      } catch (e) {
        if (req.signal?.aborted) throw cancellationError(req.signal);
        if (deadlineExpired) throw new HttpRequestError('HTTP_TOTAL_TIMEOUT', `请求总超时（${totalTimeoutMs}ms）`);
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    // 不应到达
    return { status: 0, headers: {}, content: '', finalUrl };
  }
}

function decodeCharsetGuess(contentType?: string): string {
  if (!contentType) return 'utf-8';
  const m = /charset=([\w-]+)/i.exec(contentType);
  return m ? m[1].toLowerCase() : 'utf-8';
}
