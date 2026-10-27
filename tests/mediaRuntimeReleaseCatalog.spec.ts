import { describe, expect, it, vi } from 'vitest';
import {
  readMediaRuntimeRelease,
  type MediaRuntimeReleasePort,
} from '../src/main/player/mediaRuntimeReleaseCatalog';

function jsonResponse(value: unknown, contentLength?: number): Response {
  const body = JSON.stringify(value);
  return new Response(body, {
    status: 200,
    headers: contentLength === undefined ? {} : { 'content-length': String(contentLength) },
  });
}

const release = {
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/example/runtime/releases/tag/v1.0.0',
  assets: [],
};

describe('readMediaRuntimeRelease', () => {
  it('reads and validates the official release through an injectable network port', async () => {
    const request = vi.fn(async (_url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers.accept).toBe('application/vnd.github+json');
      return jsonResponse(release);
    });

    await expect(readMediaRuntimeRelease('mpv', new AbortController().signal, { request }))
      .resolves.toEqual(release);
    expect(request).toHaveBeenCalledOnce();
  });

  it('bounds a stalled request with one total deadline', async () => {
    const port: MediaRuntimeReleasePort = {
      request: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
      }),
    };

    await expect(readMediaRuntimeRelease('ffmpeg', new AbortController().signal, port, { timeoutMs: 5 }))
      .rejects.toThrow('超过总时限');
  });

  it('aborts an in-flight metadata request when the user cancels installation', async () => {
    const controller = new AbortController();
    const port: MediaRuntimeReleasePort = {
      request: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
      }),
    };
    const pending = readMediaRuntimeRelease('mpv', controller.signal, port);
    controller.abort();

    await expect(pending).rejects.toThrow('已取消读取官方发行信息');
  });

  it('bounds response bytes using both Content-Length and streamed chunks', async () => {
    const declaredTooLarge = jsonResponse(release, 100);
    const declaredPort = { request: vi.fn(async () => declaredTooLarge) };
    await expect(readMediaRuntimeRelease('mpv', new AbortController().signal, declaredPort, { maxBodyBytes: 10 }))
      .rejects.toThrow('超过安全大小上限');

    const streamed = new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"tag_name":"too large"}'));
        stream.close();
      },
    }), { status: 200 });
    await expect(readMediaRuntimeRelease('mpv', new AbortController().signal, { request: async () => streamed }, { maxBodyBytes: 8 }))
      .rejects.toThrow('超过安全大小上限');
  });

  it('rejects empty, malformed, unsuccessful, and structurally invalid responses', async () => {
    await expect(readMediaRuntimeRelease('mpv', new AbortController().signal, {
      request: async () => new Response('', { status: 200 }),
    })).rejects.toThrow('JSON 格式异常');

    await expect(readMediaRuntimeRelease('mpv', new AbortController().signal, {
      request: async () => new Response('{"tag_name":"missing fields"}', { status: 200 }),
    })).rejects.toThrow('格式异常');

    await expect(readMediaRuntimeRelease('mpv', new AbortController().signal, {
      request: async () => new Response('rate limited', { status: 403 }),
    })).rejects.toThrow('HTTP 403');
  });
});
