import type { Dispatcher } from 'undici';
import { describe, expect, it, vi } from 'vitest';
import { UpstreamHttpClient, type UpstreamHttpPorts } from '../src/main/server/UpstreamHttpClient';

function response(statusCode: number, headers: Record<string, unknown> = {}, body = ''): Dispatcher.ResponseData {
  const bytes = Buffer.from(body);
  return {
    statusCode,
    headers,
    body: {
      dump: vi.fn(async () => undefined),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    },
  } as unknown as Dispatcher.ResponseData;
}

function clientFor(request: UpstreamHttpPorts['request'], dispatchers: Dispatcher[] = [{} as Dispatcher]) {
  const ports: UpstreamHttpPorts = { dispatchers: vi.fn(() => dispatchers), request };
  return { client: new UpstreamHttpClient(ports), ports };
}

describe('UpstreamHttpClient', () => {
  it('retries network dispatchers and follows redirects without consuming the final stream', async () => {
    const direct = {} as Dispatcher;
    const proxy = {} as Dispatcher;
    const firstBody = response(302, { location: '/episode.m3u8' }).body;
    const final = response(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('proxy unavailable'))
      .mockResolvedValueOnce({ statusCode: 302, headers: { location: '/episode.m3u8' }, body: firstBody } as unknown as Dispatcher.ResponseData)
      .mockResolvedValueOnce(final);
    const { client, ports } = clientFor(request, [proxy, direct]);

    const result = await client.openStream('https://source.example/start', { Referer: 'https://site.example/' });

    expect(ports.dispatchers).toHaveBeenNthCalledWith(1, 'https://source.example/start');
    expect(ports.dispatchers).toHaveBeenNthCalledWith(2, 'https://source.example/episode.m3u8');
    expect(request).toHaveBeenNthCalledWith(1, 'https://source.example/start', expect.objectContaining({ dispatcher: proxy, bodyTimeout: 0 }));
    expect(request).toHaveBeenNthCalledWith(2, 'https://source.example/start', expect.objectContaining({ dispatcher: direct }));
    expect(request).toHaveBeenNthCalledWith(3, 'https://source.example/episode.m3u8', expect.objectContaining({ dispatcher: proxy }));
    expect(firstBody.dump).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 200, finalUrl: 'https://source.example/episode.m3u8' });
    expect(result.body).toBe(final.body);
  });

  it('buffers small redirected responses and releases each intermediate body', async () => {
    const intermediate = response(302, { location: '../playlist.m3u8' }, 'redirect');
    const final = response(200, { 'content-type': 'application/vnd.apple.mpegurl' }, '#EXTM3U');
    const request = vi.fn().mockResolvedValueOnce(intermediate).mockResolvedValueOnce(final);
    const { client } = clientFor(request);

    const result = await client.fetchWithRedirect('https://source.example/path/start', {});

    expect(intermediate.body.dump).toHaveBeenCalledOnce();
    expect(request).toHaveBeenNthCalledWith(2, 'https://source.example/playlist.m3u8', expect.objectContaining({ bodyTimeout: 30000 }));
    expect(result).toEqual({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: Buffer.from('#EXTM3U') });
  });
});
