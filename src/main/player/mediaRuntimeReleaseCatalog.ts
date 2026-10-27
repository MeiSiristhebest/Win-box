import type { MediaRuntimeId } from '../../shared/player';
import { runtimeReleaseApiUrl, type MediaRuntimeRelease } from './mediaRuntimeReleasePolicy';

export const MEDIA_RUNTIME_RELEASE_TIMEOUT_MS = 30_000;
export const MAX_MEDIA_RUNTIME_RELEASE_BYTES = 1024 * 1024;

export interface MediaRuntimeReleasePort {
  request(url: string, init: { signal: AbortSignal; headers: Record<string, string> }): Promise<Response>;
}

export const nodeMediaRuntimeReleasePort: MediaRuntimeReleasePort = {
  request: (url, init) => fetch(url, init),
};

/** Reads the small GitHub release document with one deadline covering headers and body parsing. */
export async function readMediaRuntimeRelease(
  runtime: MediaRuntimeId,
  callerSignal: AbortSignal,
  port: MediaRuntimeReleasePort = nodeMediaRuntimeReleasePort,
  options: { timeoutMs?: number; maxBodyBytes?: number } = {},
): Promise<MediaRuntimeRelease> {
  if (callerSignal.aborted) throw new Error('已取消读取官方发行信息');
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = options.timeoutMs ?? MEDIA_RUNTIME_RELEASE_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_MEDIA_RUNTIME_RELEASE_BYTES;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('官方发行信息读取超过总时限'));
  }, timeoutMs);
  const abortFromCaller = (): void => controller.abort(callerSignal.reason);
  callerSignal.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const request = port.request(runtimeReleaseApiUrl(runtime), {
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'Win-Box media runtime installer',
      },
    });
    const response = await withAbort(request, controller.signal);
    if (!response.ok) {
      void discardResponseBody(response);
      throw new Error('读取官方发行信息失败（HTTP ' + response.status + '）');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      void discardResponseBody(response);
      throw new Error('官方发行信息超过安全大小上限');
    }
    if (!response.body) throw new Error('官方发行信息响应体为空');

    const text = await readBoundedText(response.body, controller.signal, maxBodyBytes);
    let value: Partial<MediaRuntimeRelease>;
    try { value = JSON.parse(text) as Partial<MediaRuntimeRelease>; }
    catch { throw new Error('官方发行信息 JSON 格式异常'); }
    if (!Array.isArray(value.assets) || typeof value.tag_name !== 'string' || typeof value.html_url !== 'string') {
      throw new Error('官方发行信息格式异常');
    }
    return value as MediaRuntimeRelease;
  } catch (error) {
    if (timedOut) throw new Error('读取官方发行信息超过总时限，已停止请求');
    if (callerSignal.aborted) throw new Error('已取消读取官方发行信息');
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal.removeEventListener('abort', abortFromCaller);
  }
}

async function readBoundedText(stream: ReadableStream<Uint8Array>, signal: AbortSignal, maxBytes: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const next = await withAbort(reader.read(), signal);
      if (next.done) break;
      received += next.value.byteLength;
      if (received > maxBytes) {
        void reader.cancel('response exceeded size limit').catch(() => undefined);
        throw new Error('官方发行信息超过安全大小上限');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('请求已取消'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new Error('请求已取消'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

async function discardResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* response is already closed */ }
}
