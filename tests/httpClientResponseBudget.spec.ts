import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/main/net/HttpClient';

describe('HttpClient bounded response reads', () => {
  let server: Server | undefined;
  let lateTimer: ReturnType<typeof setInterval> | undefined;

  afterEach(async () => {
    if (lateTimer) clearInterval(lateTimer);
    lateTimer = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  async function listen(handler: RequestListener): Promise<number> {
    server = createServer(handler);
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    return address.port;
  }

  it('accepts the exact byte limit and reports loaded/total progress', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Length': '5' });
      res.end('12345');
    });
    const progress = vi.fn();

    const response = await new HttpClient().request({
      url: `http://127.0.0.1:${port}/exact`,
      maxResponseBytes: 5,
      onProgress: progress,
    });

    expect(response).toMatchObject({ status: 200, content: '12345' });
    expect(progress).toHaveBeenCalledWith(0, 5);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it('rejects a known oversized body before retaining it and keeps a typed failure', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Length': '6' });
      res.end('123456');
    });

    await expect(new HttpClient().request({ url: `http://127.0.0.1:${port}/large`, maxResponseBytes: 5 }))
      .rejects.toMatchObject({ name: 'HttpRequestError', code: 'HTTP_RESPONSE_TOO_LARGE' });
  });

  it('rejects a chunked body when it crosses the byte limit without returning a partial success', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200, { 'Transfer-Encoding': 'chunked' });
      res.write('123');
      setTimeout(() => { if (!res.destroyed) res.write('456'); }, 5);
    });

    await expect(new HttpClient().request({ url: `http://127.0.0.1:${port}/chunked`, maxResponseBytes: 5 }))
      .rejects.toMatchObject({ code: 'HTTP_RESPONSE_TOO_LARGE' });
  });

  it('applies the overall deadline while a body continues to make slow progress', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200, { 'Transfer-Encoding': 'chunked' });
      res.write('a');
      lateTimer = setInterval(() => {
        if (res.destroyed || res.writableEnded) return;
        res.write('b');
      }, 10);
    });

    await expect(new HttpClient().request({
      url: `http://127.0.0.1:${port}/slow`,
      timeoutMs: 1000,
      totalTimeoutMs: 60,
      maxResponseBytes: 1024,
    })).rejects.toMatchObject({ name: 'HttpRequestError', code: 'HTTP_TOTAL_TIMEOUT' });
  });

  it('cancels body consumption when the caller aborts', async () => {
    let responseStarted = false;
    let responseClosed = false;
    const port = await listen((_req, res) => {
      responseStarted = true;
      res.writeHead(200, { 'Transfer-Encoding': 'chunked' });
      res.write('a');
      res.once('close', () => { responseClosed = true; });
      lateTimer = setInterval(() => {
        if (res.destroyed || res.writableEnded) return;
        res.write('b');
      }, 10);
    });
    const controller = new AbortController();
    const pending = new HttpClient().request({
      url: `http://127.0.0.1:${port}/cancel`,
      totalTimeoutMs: 1000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(responseStarted).toBe(true));
    controller.abort(new Error('caller cancelled'));

    await expect(pending).rejects.toMatchObject({ name: 'HttpRequestError', code: 'HTTP_CANCELLED' });
    await vi.waitFor(() => expect(responseClosed).toBe(true));
  });

  it('returns upstream HTTP error statuses unchanged instead of treating them as success', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
    });

    const response = await new HttpClient().request({ url: `http://127.0.0.1:${port}/missing` });

    expect(response).toMatchObject({ status: 404, content: '{"error":"not found"}' });
  });
});
