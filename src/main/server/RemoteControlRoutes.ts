// src/main/server/RemoteControlRoutes.ts
// 9978 端口内置局域网 Web 服务器与手机端远程控制/推送路由：
// 提供 /index.html、/script.js、/style.css 及 /action 远程推送控制。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../../shared/types';

export interface RemotePushAction {
  do: string;
  name?: string;
  url?: string;
  address?: string;
  token?: string;
  word?: string;
  text?: string;
  raw: Record<string, string>;
}

export interface RemoteControlRoutesPorts {
  assetsDir: () => string;
  logger: Logger;
  onAction?: (action: RemotePushAction) => Promise<void> | void;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const DEFAULT_INDEX_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Win-Box 局域网控制台</title></head>
<body><h2>Win-Box 局域网推送服务运行中</h2><p>请通过手机端访问</p></body>
</html>`;

export class RemoteControlRoutes {
  private cache = new Map<string, { body: Buffer; mime: string }>();

  constructor(private readonly ports: RemoteControlRoutesPorts) {}

  matches(pathname: string): boolean {
    return (
      pathname === '/' ||
      pathname === '/index.html' ||
      pathname === '/style.css' ||
      pathname === '/ui.css' ||
      pathname === '/script.js' ||
      pathname === '/jquery.js' ||
      pathname === '/action' ||
      pathname === '/favicon.ico'
    );
  }

  async handle(u: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = u.pathname;
    if (pathname === '/action') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        });
        res.end();
        return;
      }
      if (req.method === 'POST') {
        return this.handleAction(req, res);
      }
    }

    // Static assets
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    const cached = this.cache.get(filename);
    if (cached) {
      res.writeHead(200, {
        'Content-Type': cached.mime,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(cached.body);
      return;
    }

    const dir = this.ports.assetsDir();
    const filePath = join(dir, filename);
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '.html';
    const mime = MIME_TYPES[ext] || 'text/plain; charset=utf-8';

    try {
      if (existsSync(filePath)) {
        const body = await readFile(filePath);
        this.cache.set(filename, { body, mime });
        res.writeHead(200, {
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(body);
        return;
      }
    } catch (err) {
      this.ports.logger.w(`remote-web: 无法读取静态文件 ${filename}: ${(err as Error).message}`);
    }

    if (filename === 'index.html') {
      const fallback = Buffer.from(DEFAULT_INDEX_HTML, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(fallback);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }

  private async handleAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let length = 0;
    const MAX_BODY = 1024 * 1024; // 1MB

    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_BODY) {
          reject(new Error('Payload too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve());
      req.on('error', reject);
    });

    const rawBody = Buffer.concat(chunks).toString('utf-8');
    const raw: Record<string, string> = {};

    if (rawBody.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(rawBody) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          raw[k] = typeof v === 'string' ? v : String(v ?? '');
        }
      } catch {
        /* fallback to form parsing */
      }
    }

    if (!Object.keys(raw).length) {
      const params = new URLSearchParams(rawBody);
      for (const [k, v] of params.entries()) {
        raw[k] = v;
      }
    }

    const doAction = (raw.do || (raw.type === 'danmaku' ? 'danmaku' : '')).trim();
    const action: RemotePushAction = {
      do: doAction,
      name: (raw.pushStore_name || raw.live_name || raw.name || '').trim(),
      url: (raw.pushStore_url || raw.url || '').trim(),
      address: (raw.live_address || raw.address || '').trim(),
      token: (raw.push_AliToken || raw.token || '').trim(),
      word: (raw.word || '').trim(),
      text: (raw.path || raw.text || '').trim(),
      raw,
    };

    this.ports.logger.i(`remote-web: 收到动作 do=${action.do} name=${action.name || ''} url=${action.url || ''}`);

    try {
      await this.ports.onAction?.(action);
    } catch (e) {
      this.ports.logger.w(`remote-web: 执行动作 ${action.do} 失败: ${(e as Error).message}`);
    }

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end('ok');
  }
}
