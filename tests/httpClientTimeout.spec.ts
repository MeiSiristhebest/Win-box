import { createServer, type Server } from 'node:http';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { HttpClient } from '../src/main/net/HttpClient';

describe('HttpClient totalTimeoutMs', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('also aborts while reading a delayed response body', async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.write('header-received');
      setTimeout(() => res.end('body-too-late'), 150);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port');

    const startedAt = Date.now();
    await expect(new HttpClient().request({
      url: `http://127.0.0.1:${address.port}/slow`,
      timeoutMs: 1000,
      totalTimeoutMs: 30,
      buffer: 1,
    })).rejects.toThrow('请求总超时');
    expect(Date.now() - startedAt).toBeLessThan(130);
  });

  it('aborts an in-flight response when the caller signal is cancelled', async () => {
    let responseStarted = false;
    let responseClosed = false;
    server = createServer((_req, res) => {
      responseStarted = true;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.write('first chunk');
      res.once('close', () => { responseClosed = true; });
      setTimeout(() => { if (!res.destroyed) res.end('late chunk'); }, 500);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port');

    const controller = new AbortController();
    const pending = new HttpClient().request({
      url: `http://127.0.0.1:${address.port}/cancel`,
      timeoutMs: 1000,
      buffer: 1,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(responseStarted).toBe(true));
    controller.abort(new Error('subscription import cancelled'));
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(responseClosed).toBe(true));
  });
});
