import { existsSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { Logger } from '../../shared/types';
import { resolvePkgFile } from '../../engine/config/localPkg';
import { resolveLocalFilePath } from './LocalFileAccess';

export interface LocalFileRoutePorts {
  roots(): string[];
  packageRoot(index: number): string | null;
  logger: Pick<Logger, 'e'>;
}

/** Local filesystem adapters for the app-private `/file` and imported `/pkg` routes. */
export class LocalFileRoutes {
  constructor(private readonly ports: LocalFileRoutePorts) {}

  file(url: URL, response: ServerResponse): void {
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(url.pathname.slice('/file/'.length));
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('bad request');
      return;
    }
    const absolutePath = resolveLocalFilePath(relativePath, this.ports.roots());
    if (!absolutePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    this.send(absolutePath, response);
  }

  packageFile(url: URL, response: ServerResponse): void {
    const match = /^\/pkg\/(\d+)\/(.+)$/.exec(url.pathname);
    if (!match) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    let relativePath = match[2];
    try {
      relativePath = decodeURIComponent(relativePath);
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('bad request');
      return;
    }
    const root = this.ports.packageRoot(Number(match[1]));
    const absolutePath = root ? resolvePkgFile(root, relativePath) : null;
    if (!absolutePath || !existsSync(absolutePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    this.send(absolutePath, response, true);
  }

  private send(absolutePath: string, response: ServerResponse, noCache = false): void {
    try {
      const body = readFileSync(absolutePath);
      const headers: Record<string, string> = { 'Content-Type': guessContentType(absolutePath) };
      if (noCache) headers['Cache-Control'] = 'no-cache';
      response.writeHead(200, headers);
      response.end(body);
    } catch (error) {
      this.ports.logger.e(`proxy 本地文件读取失败: ${absolutePath}`, error);
      if (!response.headersSent) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('not found');
      }
    }
  }
}

/** Content-Type mapping for formats served from the private app files and imported packages. */
export function guessContentType(path: string): string {
  const value = path.toLowerCase();
  if (value.endsWith('.json')) return 'application/json; charset=utf-8';
  if (value.endsWith('.txt') || value.endsWith('.m3u') || value.endsWith('.m3u8')) return 'text/plain; charset=utf-8';
  if (value.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (value.endsWith('.py')) return 'text/plain; charset=utf-8';
  if (value.endsWith('.css')) return 'text/css; charset=utf-8';
  if (value.endsWith('.html') || value.endsWith('.htm')) return 'text/html; charset=utf-8';
  if (value.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (value.endsWith('.png')) return 'image/png';
  if (value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'image/jpeg';
  if (value.endsWith('.gif')) return 'image/gif';
  if (value.endsWith('.webp')) return 'image/webp';
  if (value.endsWith('.svg')) return 'image/svg+xml';
  if (value.endsWith('.mp4') || value.endsWith('.m4v')) return 'video/mp4';
  if (value.endsWith('.webm')) return 'video/webm';
  if (value.endsWith('.mkv')) return 'video/x-matroska';
  if (value.endsWith('.mov')) return 'video/quicktime';
  if (value.endsWith('.ts')) return 'video/mp2t';
  if (value.endsWith('.avi')) return 'video/x-msvideo';
  if (value.endsWith('.flv')) return 'video/x-flv';
  return 'application/octet-stream';
}
