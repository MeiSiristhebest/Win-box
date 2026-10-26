import type { Dispatcher } from 'undici';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { UpstreamHttpClient, type UpstreamHttpPorts } from '../src/main/server/UpstreamHttpClient';

function response(
  statusCode: number,
  headers: Record<string, unknown> = {},
  body: string | Buffer | Readable = '',
): Dispatcher.ResponseData {
  const readable = body instanceof Readable
    ? body
    : Readable.from(body.length ? [Buffer.from(body)] : []);
  const withDump = Object.assign(readable, {
    dump: vi.fn(async () => { for await (const _chunk of readable) { /* consume redirect body */ } }),
  });
  return {
    statusCode,
    headers,
    body: withDump,
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
    expect(firstBody.destroyed).toBe(true);
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

  it('enforces buffered response limits and reports progress in wire bytes', async () => {
    const final = response(200, { 'content-length': '4', 'content-type': 'application/json' }, '{"a":1}');
    const request = vi.fn().mockResolvedValue(final);
    const { client } = clientFor(request);
    const progress: Array<[number, number | undefined]> = [];

    await expect(client.fetchWithRedirect('https://source.example/data', {}, {
      maxResponseBytes: 4,
      onProgress: (loaded, total) => progress.push([loaded, total]),
    })).rejects.toMatchObject({ code: 'HTTP_RESPONSE_TOO_LARGE' });
    expect(progress).toContainEqual([0, 4]);
    expect(final.body.destroyed).toBe(true);
  });

  it('accepts a body exactly at the configured response boundary', async () => {
    const { client } = clientFor(vi.fn().mockResolvedValue(
      response(200, { 'content-length': '4' }, '1234'),
    ));
    const progress: Array<[number, number | undefined]> = [];

    await expect(client.fetchWithRedirect('https://source.example/exact', {}, {
      maxResponseBytes: 4,
      onProgress: (loaded, total) => progress.push([loaded, total]),
    })).resolves.toMatchObject({ status: 200, body: Buffer.from('1234') });
    expect(progress).toContainEqual([4, 4]);
  });

  it('applies the total deadline while waiting for response headers', async () => {
    let observedSignal: AbortSignal | undefined;
    const request: UpstreamHttpPorts['request'] = vi.fn((_url, options) => {
      observedSignal = options.signal;
      return new Promise<Dispatcher.ResponseData>(() => undefined);
    });
    const { client } = clientFor(request);

    await expect(client.fetchWithRedirect('https://source.example/slow', {}, { totalTimeoutMs: 10 }))
      .rejects.toMatchObject({ code: 'HTTP_TOTAL_TIMEOUT' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('cancels a buffered body read when the caller aborts', async () => {
    const controller = new AbortController();
    const body = new Readable({ read() { /* intentionally never yields */ } });
    const { client } = clientFor(vi.fn().mockResolvedValue(response(200, {}, body)));
    const result = client.fetchWithRedirect('https://source.example/slow-body', {}, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(result).rejects.toMatchObject({ code: 'HTTP_CANCELLED' });
    expect(body.destroyed).toBe(true);
  });

  it('preserves unsuccessful HTTP status instead of coercing it to success', async () => {
    const { client } = clientFor(vi.fn().mockResolvedValue(response(404, { 'content-type': 'text/plain' }, 'missing')));

    await expect(client.fetchWithRedirect('https://source.example/missing', {})).resolves.toMatchObject({
      status: 404,
      body: Buffer.from('missing'),
    });
  });

  it('keeps large Range media streaming outside the buffered response budget', async () => {
    const mediaBytes = Buffer.alloc(10 * 1024 * 1024, 7);
    const media = response(206, { 'content-length': String(mediaBytes.length), 'content-range': `bytes 0-${mediaBytes.length - 1}/${mediaBytes.length}` }, mediaBytes);
    const request = vi.fn().mockResolvedValue(media);
    const { client } = clientFor(request);

    const streamed = await client.openStream('https://media.example/video.mp4', { Range: 'bytes=0-' });
    expect(streamed).toMatchObject({ status: 206 });
    expect(request).toHaveBeenCalledWith('https://media.example/video.mp4', expect.objectContaining({
      bodyTimeout: 0,
      headers: expect.objectContaining({ Range: 'bytes=0-' }),
    }));
    let received = 0;
    for await (const chunk of streamed.body) received += Buffer.byteLength(chunk as Buffer);
    expect(received).toBe(mediaBytes.length);
  });

  it('bounds already-classified manifest bodies', async () => {
    const { client } = clientFor(vi.fn());
    const body = Readable.from([Buffer.from('#EXTM3U' + 'x'.repeat(20))]);

    await expect(client.readBufferedBody(body as Dispatcher.ResponseData['body'], {
      maxResponseBytes: 8,
      totalTimeoutMs: 1000,
    })).rejects.toMatchObject({ code: 'HTTP_RESPONSE_TOO_LARGE' });
    expect(body.destroyed).toBe(true);
  });
});
