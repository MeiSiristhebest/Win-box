import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseBtRoute } from '../../engine/torrent/magnet';
import type { Logger } from '../../shared/types';
import { parseByteRange } from './mediaTransforms';
import { guessContentType } from './LocalFileRoutes';

/** Torrent access port; the media proxy does not depend on aria2 or its session model. */
export interface BtStreamAccess {
  resolveStream(infoHash: string, fileIndex: number): { absPath: string; length: number; fileOffset: number; pieceLength: number } | null;
  waitCovered(infoHash: string, fileIndex: number, start: number, end: number, opts?: { timeoutMs?: number; stallMs?: number }): Promise<boolean>;
}

export interface BtMediaProxyPorts {
  access(): BtStreamAccess | undefined;
  logger: Pick<Logger, 'w'>;
  speedReportingEnabled(): boolean;
  reportSpeed(kbs: number): void;
}

/** Serves local torrent files with byte ranges and downloaded-piece readiness gates. */
export class BtMediaProxy {
  private readonly chunkSize = 512 * 1024;

  constructor(private readonly ports: BtMediaProxyPorts) {}

  async handle(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = parseBtRoute(url.pathname);
    const access = route ? this.ports.access() : undefined;
    const stream = route && access ? access.resolveStream(route.infoHash, route.fileIndex) : null;
    if (!route || !stream || !access) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('bt session not found');
      return;
    }
    const total = stream.length;
    if (!(total > 0)) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('bt file empty');
      return;
    }
    const rangeHeader = request.headers.range;
    const range = rangeHeader === undefined ? '' : Array.isArray(rangeHeader) ? rangeHeader[0] : String(rangeHeader);
    let start = 0;
    let end = total - 1;
    const partial = !!range;
    if (range) {
      const parsed = parseByteRange(range);
      if (!parsed) {
        response.writeHead(416, { 'Content-Range': `bytes */${total}` });
        response.end();
        return;
      }
      start = Math.min(Math.max(0, parsed.start), total - 1);
      end = parsed.end === undefined ? total - 1 : Math.min(parsed.end, total - 1);
      if (end < start) {
        response.writeHead(416, { 'Content-Range': `bytes */${total}` });
        response.end();
        return;
      }
    }
    const headers: Record<string, string> = {
      'Content-Type': guessContentType(stream.absPath),
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Access-Control-Allow-Origin': '*',
    };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    if (request.method === 'HEAD') {
      response.writeHead(partial ? 206 : 200, headers);
      response.end();
      return;
    }

    const firstEnd = Math.min(end, start + this.chunkSize - 1);
    const ready = await access.waitCovered(route.infoHash, route.fileIndex, start, firstEnd);
    if (response.destroyed || request.destroyed) return;
    if (!ready) {
      this.ports.logger.w(`proxy /bt: 首段未就绪（做种冷/超时）${route.infoHash.slice(0, 8)} [${start},${firstEnd}]`);
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('bt data not ready');
      return;
    }

    response.writeHead(partial ? 206 : 200, headers);
    const output = { bytes: 0, previousBytes: 0, previousTime: 0 };
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    response.once('close', stop);
    response.once('finish', stop);
    if (this.ports.speedReportingEnabled()) {
      timer = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - output.previousTime) / 1000;
        if (output.previousTime > 0 && elapsed > 0) {
          const kbs = (output.bytes - output.previousBytes) / 1024 / elapsed;
          if (kbs > 0) this.ports.reportSpeed(kbs);
        }
        output.previousBytes = output.bytes;
        output.previousTime = now;
      }, 600);
    }
    const aborted = () => response.destroyed || request.destroyed;
    try {
      for (let position = start; position <= end; position += this.chunkSize) {
        const chunkEnd = Math.min(position + this.chunkSize - 1, end);
        if (position > start) {
          const covered = await access.waitCovered(route.infoHash, route.fileIndex, position, chunkEnd);
          if (aborted()) return;
          if (!covered) {
            this.ports.logger.w(`proxy /bt: 片段未就绪，断开本次取流 ${route.infoHash.slice(0, 8)} [${position},${chunkEnd}]`);
            response.destroy();
            return;
          }
        }
        await this.pipeFileSlice(stream.absPath, position, chunkEnd, response, output);
        if (aborted()) return;
      }
      if (!response.writableEnded) response.end();
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'AbortError') this.ports.logger.w(`proxy /bt 取流异常：${(error as Error).message}`);
      response.destroy();
    }
  }

  private pipeFileSlice(path: string, start: number, end: number, response: ServerResponse, output: { bytes: number }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path, { start, end });
      stream.on('data', (chunk) => {
        output.bytes += chunk.length;
        if (!response.write(chunk)) {
          stream.pause();
          response.once('drain', () => stream.resume());
        }
      });
      stream.on('error', (error) => { stream.destroy(); reject(error); });
      stream.on('end', () => resolve());
      response.once('close', () => stream.destroy());
    });
  }
}
