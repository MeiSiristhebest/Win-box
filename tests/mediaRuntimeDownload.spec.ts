import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  downloadVerifiedMediaRuntime,
  type MediaRuntimeDownloadPort,
} from '../src/main/player/mediaRuntimeDownload';

function response(body: ReadableStream<Uint8Array>, contentLength?: number): Response {
  const value = {
    ok: true,
    status: 200,
    url: 'https://release-assets.githubusercontent.com/runtime.zip',
    body,
    headers: new Headers(contentLength === undefined ? {} : { 'content-length': String(contentLength) }),
  };
  return value as Response;
}

function redirect(status: number, url: string, location: string): Response {
  return {
    ok: false,
    status,
    url,
    body: null,
    headers: new Headers({ location }),
  } as Response;
}

function bytes(values: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from(values));
      controller.close();
    },
  });
}

function input(overrides: Partial<Parameters<typeof downloadVerifiedMediaRuntime>[0]> = {}) {
  const data = Uint8Array.from([1, 2, 3]);
  return {
    url: 'https://github.com/example/runtime.zip',
    destination: 'unused-in-test.zip',
    expectedBytes: data.byteLength,
    expectedSha256: createHash('sha256').update(data).digest('hex'),
    signal: new AbortController().signal,
    timeoutMs: 500,
    ...overrides,
  };
}

function portFor(body: ReadableStream<Uint8Array>, contentLength?: number): MediaRuntimeDownloadPort {
  const writeResponseBody = vi.fn(async (
    stream: ReadableStream<Uint8Array>,
    _destination: string,
    signal: AbortSignal,
    inspectChunk: (chunk: Uint8Array) => void,
  ) => {
    const reader = stream.getReader();
    try {
      for (;;) {
        if (signal.aborted) throw signal.reason;
        const next = await reader.read();
        if (next.done) return;
        inspectChunk(next.value);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  });
  return {
    request: vi.fn(async () => response(body, contentLength)),
    writeResponseBody,
  };
}

describe('downloadVerifiedMediaRuntime', () => {
  it('streams the expected number of bytes and verifies the official digest', async () => {
    const updates: Array<[number, number]> = [];
    await expect(downloadVerifiedMediaRuntime(input({ onProgress: (received, total) => updates.push([received, total]) }), portFor(bytes([1, 2, 3]), 3))).resolves.toBeUndefined();
    expect(updates.at(-1)).toEqual([3, 3]);
  });

  it('manually follows and validates every trusted redirect hop', async () => {
    const requests: Array<[string, { redirect: 'manual' }]> = [];
    const port: MediaRuntimeDownloadPort = {
      request: vi.fn(async (url, init) => {
        requests.push([url, { redirect: init.redirect }]);
        if (url === 'https://github.com/example/runtime.zip') {
          return redirect(302, url, 'https://release-assets.githubusercontent.com/runtime.zip');
        }
        return response(bytes([1, 2, 3]));
      }),
      writeResponseBody: portFor(bytes([1, 2, 3])).writeResponseBody,
    };

    await expect(downloadVerifiedMediaRuntime(input(), port)).resolves.toBeUndefined();
    expect(requests).toEqual([
      ['https://github.com/example/runtime.zip', { redirect: 'manual' }],
      ['https://release-assets.githubusercontent.com/runtime.zip', { redirect: 'manual' }],
    ]);
  });

  it('rejects an untrusted intermediate redirect before requesting it', async () => {
    const port: MediaRuntimeDownloadPort = {
      request: vi.fn(async (url) => redirect(302, url, 'https://evil.example/payload.zip')),
      writeResponseBody: vi.fn(),
    };

    await expect(downloadVerifiedMediaRuntime(input(), port)).rejects.toThrow('未认可的域名');
    expect(port.request).toHaveBeenCalledTimes(1);
  });

  it('rejects a response that declares an oversized body before opening the destination', async () => {
    const port = portFor(bytes([1, 2, 3, 4]), 4);
    await expect(downloadVerifiedMediaRuntime(input(), port)).rejects.toThrow('超过官方记录');
    expect(port.writeResponseBody).not.toHaveBeenCalled();
  });

  it('stops streaming as soon as received bytes exceed the official asset size', async () => {
    const port = portFor(bytes([1, 2, 3, 4]));
    await expect(downloadVerifiedMediaRuntime(input(), port)).rejects.toThrow('超过官方记录');
  });

  it('rejects a short response and a digest mismatch', async () => {
    await expect(downloadVerifiedMediaRuntime(input({ expectedBytes: 4 }), portFor(bytes([1, 2, 3])))).rejects.toThrow('大小与官方记录不符');
    await expect(downloadVerifiedMediaRuntime(input({ expectedSha256: '0'.repeat(64) }), portFor(bytes([1, 2, 3])))).rejects.toThrow('SHA-256 校验失败');
  });

  it('aborts a stalled request when its total deadline expires', async () => {
    const port: MediaRuntimeDownloadPort = {
      request: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
      }),
      writeResponseBody: vi.fn(),
    };
    await expect(downloadVerifiedMediaRuntime(input({ timeoutMs: 10 }), port)).rejects.toThrow('超过总时限');
  });

  it('aborts a stalled body when the user cancels the installation', async () => {
    const controller = new AbortController();
    const port: MediaRuntimeDownloadPort = {
      request: vi.fn(async () => response(bytes([1, 2, 3]))),
      writeResponseBody: (_body, _destination, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
      }),
    };
    setTimeout(() => controller.abort(), 5);
    await expect(downloadVerifiedMediaRuntime(input({ signal: controller.signal }), port)).rejects.toThrow('已取消下载');
  });
});
