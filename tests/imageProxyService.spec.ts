import type { ServerResponse } from 'node:http';
import type { Dispatcher } from 'undici';
import { describe, expect, it, vi } from 'vitest';
import { ImageProxyService, type ImageProxyPorts, type ImageProxyResponse } from '../src/main/server/ImageProxyService';

function responseSink() {
  return {
    writableEnded: false,
    destroyed: false,
    once: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(function (this: { writableEnded: boolean }) { this.writableEnded = true; }),
  } as unknown as ServerResponse & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
}

function upstream(statusCode: number, contentType: string, body = 'image-bytes'): ImageProxyResponse {
  const bytes = Buffer.from(body);
  return {
    statusCode,
    headers: { 'content-type': contentType },
    body: {
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      dump: vi.fn(async () => undefined),
    },
  };
}

function makePorts(request: ImageProxyPorts['request']): ImageProxyPorts {
  return { dispatchers: vi.fn(() => [{} as Dispatcher]), request };
}

describe('ImageProxyService', () => {
  it('rejects non-http image targets before making an outbound request', async () => {
    const request = vi.fn();
    const service = new ImageProxyService(makePorts(request));
    const sink = responseSink();

    await service.handle(new URL('http://127.0.0.1:9978/img?u=file%3A%2F%2Fsecret'), sink);

    expect(sink.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(sink.end).toHaveBeenCalledWith('bad request');
    expect(request).not.toHaveBeenCalled();
  });

  it('tries supplied and domestic Douban Referers before accepting an image', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(upstream(403, 'text/html'))
      .mockResolvedValueOnce(upstream(206, 'image/webp'));
    const ports = makePorts(request);
    const service = new ImageProxyService(ports);
    const sink = responseSink();

    await service.handle(new URL('http://127.0.0.1:9978/img?u=https%3A%2F%2Fimg.doubanio.com%2Fposter.jpg&ref=https%3A%2F%2Fsource.example%2F'), sink);

    expect(ports.dispatchers).toHaveBeenCalledWith('https://img.doubanio.com/poster.jpg', true);
    expect(request.mock.calls[0][1].headers.Referer).toBe('https://source.example/');
    expect(request.mock.calls[1][1].headers.Referer).toBe('https://m.douban.com/');
    expect(sink.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400' });
    expect(sink.end).toHaveBeenCalledWith(Buffer.from('image-bytes'));
  });

  it('rejects HTML error pages and ends with a non-cacheable 404', async () => {
    const request = vi.fn(async () => upstream(200, 'text/html'));
    const service = new ImageProxyService(makePorts(request));
    const sink = responseSink();

    await service.handle(new URL('http://127.0.0.1:9978/img?u=https%3A%2F%2Fcdn.example%2Fposter.jpg'), sink);

    expect(request).toHaveBeenCalledTimes(2); // Origin Referer, then no Referer.
    expect(sink.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    expect(sink.end).toHaveBeenCalledWith('not found');
  });
});
