import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/shared/types';
import {
  SelfResolveMediaProbe,
  type SelfResolveRangeResponse,
} from '../src/main/net/SelfResolveMediaProbe';

function response(statusCode: number, contentType: string) {
  const body = { on: vi.fn(), destroy: vi.fn() };
  const value: SelfResolveRangeResponse = {
    statusCode,
    headers: { 'content-type': contentType },
    body,
  };
  return { value, body };
}

describe('SelfResolveMediaProbe', () => {
  it('sends a one-byte range and accepts successful media content', async () => {
    const logger: Logger = { i: vi.fn(), w: vi.fn(), e: vi.fn() };
    const reply = response(206, 'video/mp4');
    const request = vi.fn(async () => reply.value);
    const probe = new SelfResolveMediaProbe({ logger, request });

    await expect(probe.probe('https://cdn.example/movie.mp4')).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith('https://cdn.example/movie.mp4', {
      method: 'GET',
      headers: { range: 'bytes=0-0', accept: '*/*' },
      headersTimeout: 20_000,
      bodyTimeout: 20_000,
    });
    expect(reply.body.destroy).toHaveBeenCalledOnce();
  });

  it('rejects successful HTML responses and reports the source response', async () => {
    const logger: Logger = { i: vi.fn(), w: vi.fn(), e: vi.fn() };
    const reply = response(200, 'text/html');
    const probe = new SelfResolveMediaProbe({ logger, request: async () => reply.value });

    await expect(probe.probe('https://source.example/watch')).resolves.toBe(false);
    expect(reply.body.destroy).toHaveBeenCalledOnce();
    expect(logger.w).toHaveBeenCalledWith(expect.stringContaining('status=200 ct=text/html'));
  });

  it('converts transport failures into a rejected probe and keeps a diagnostic', async () => {
    const logger: Logger = { i: vi.fn(), w: vi.fn(), e: vi.fn() };
    const probe = new SelfResolveMediaProbe({
      logger,
      request: async () => {
        throw new Error('upstream closed');
      },
    });

    await expect(probe.probe('https://source.example/media')).resolves.toBe(false);
    expect(logger.w).toHaveBeenCalledWith('play: 自解链预检异常: upstream closed');
  });
});
