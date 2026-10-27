import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isTrustedRuntimeDownloadRedirect } from './mediaRuntimeReleasePolicy';

export const MAX_MEDIA_RUNTIME_ARCHIVE_BYTES = 250 * 1024 * 1024;
export const MEDIA_RUNTIME_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export interface MediaRuntimeDownloadPort {
  request(url: string, init: { signal: AbortSignal; headers: Record<string, string>; redirect: 'manual' }): Promise<Response>;
  writeResponseBody(
    body: ReadableStream<Uint8Array>,
    destination: string,
    signal: AbortSignal,
    inspectChunk: (chunk: Uint8Array) => void,
  ): Promise<void>;
}

export interface VerifiedRuntimeDownload {
  url: string;
  destination: string;
  expectedBytes: number;
  expectedSha256: string;
  signal: AbortSignal;
  timeoutMs?: number;
  onProgress?: (received: number, total: number) => void;
}

export const nodeMediaRuntimeDownloadPort: MediaRuntimeDownloadPort = {
  request: (url, init) => fetch(url, init),
  async writeResponseBody(body, destination, signal, inspectChunk) {
    const meter = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        try {
          inspectChunk(bytes);
          callback(null, bytes);
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    await pipeline(
      Readable.fromWeb(body as import('node:stream/web').ReadableStream),
      meter,
      createWriteStream(destination, { flags: 'wx' }),
      { signal },
    );
  },
};

/** Stream one official runtime archive to disk under a single total deadline. */
export async function downloadVerifiedMediaRuntime(
  input: VerifiedRuntimeDownload,
  port: MediaRuntimeDownloadPort = nodeMediaRuntimeDownloadPort,
): Promise<void> {
  const { url, destination, expectedBytes, expectedSha256, signal } = input;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_MEDIA_RUNTIME_ARCHIVE_BYTES) {
    throw new Error('官方发行包大小超出允许范围');
  }
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error('官方发行包 SHA-256 格式异常');
  if (signal.aborted) throw new Error('已取消下载');

  const deadline = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort(new Error('media runtime download deadline exceeded'));
  }, input.timeoutMs ?? MEDIA_RUNTIME_DOWNLOAD_TIMEOUT_MS);
  const onAbort = (): void => deadline.abort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    const response = await requestTrustedRedirectChain(url, port, deadline.signal);
    if (!response.ok || !response.body) {
      await discardResponseBody(response);
      throw new Error('下载官方发行包失败（HTTP ' + response.status + '）');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > expectedBytes) {
      await discardResponseBody(response);
      throw new Error('下载响应超过官方记录的文件大小');
    }

    const hash = createHash('sha256');
    let received = 0;
    let lastUpdate = 0;
    input.onProgress?.(0, expectedBytes);
    await port.writeResponseBody(response.body, destination, deadline.signal, (chunk) => {
      received += chunk.byteLength;
      if (received > expectedBytes || received > MAX_MEDIA_RUNTIME_ARCHIVE_BYTES) {
        throw new Error('下载响应超过官方记录的文件大小');
      }
      hash.update(chunk);
      const now = Date.now();
      if (now - lastUpdate > 200 || received === expectedBytes) {
        lastUpdate = now;
        input.onProgress?.(received, expectedBytes);
      }
    });

    if (received !== expectedBytes) throw new Error('下载文件大小与官方记录不符');
    if (hash.digest('hex') !== expectedSha256.toLowerCase()) throw new Error('SHA-256 校验失败，文件已丢弃');
  } catch (error) {
    if (timedOut) throw new Error('下载超过总时限，已停止并清理临时文件');
    if (signal.aborted) throw new Error('已取消下载');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

const MAX_RUNTIME_DOWNLOAD_REDIRECTS = 8;

/** Follow redirects explicitly so every hop is checked before a request reaches its host. */
async function requestTrustedRedirectChain(
  initialUrl: string,
  port: MediaRuntimeDownloadPort,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = initialUrl;
  if (!isTrustedRuntimeDownloadRedirect(currentUrl)) throw new Error('发行包下载地址不在认可的 HTTPS 域名');
  const init = {
    signal,
    headers: { 'user-agent': 'Win-Box media runtime installer' },
    redirect: 'manual' as const,
  };

  for (let redirects = 0; ; redirects += 1) {
    if (signal.aborted) throw new Error('已取消下载');
    const response = await port.request(currentUrl, init);
    const responseUrl = response.url || currentUrl;
    if (!isTrustedRuntimeDownloadRedirect(responseUrl)) {
      await discardResponseBody(response);
      throw new Error('发行包重定向到了未认可的域名');
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) {
      await discardResponseBody(response);
      throw new Error('发行包重定向缺少目标地址');
    }
    if (redirects >= MAX_RUNTIME_DOWNLOAD_REDIRECTS) {
      await discardResponseBody(response);
      throw new Error('发行包重定向次数超过安全上限');
    }
    let nextUrl: string;
    try { nextUrl = new URL(location, responseUrl).toString(); }
    catch {
      await discardResponseBody(response);
      throw new Error('发行包重定向地址无效');
    }
    if (!isTrustedRuntimeDownloadRedirect(nextUrl)) {
      await discardResponseBody(response);
      throw new Error('发行包重定向到了未认可的域名');
    }
    await discardResponseBody(response);
    currentUrl = nextUrl;
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* response is already closed */ }
}
