import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Agent, request } from 'undici';
import type { UpdateAsset, UpdateProgress } from '../../shared/update';
import { dispatchChain } from '../net/proxy';

const agent = new Agent({ connect: { timeout: 20_000 } });
export type UpdateRequest = typeof request;

export function discardUpdateBody(body: Awaited<ReturnType<UpdateRequest>>['body']): void {
  body.once('error', () => undefined); // Undici emits an expected abort error when an unused body is destroyed.
  body.destroy();
}

export async function verifyUpdateFile(path: string, asset: UpdateAsset, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.size) throw new Error('安装包大小不符，请重新下载');
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('安装包缺少可信摘要');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  signal?.throwIfAborted();
  if (hash.digest('hex') !== asset.sha256) throw new Error('安装包 SHA-256 校验失败，请重新下载');
}

async function downloadOne(url: string, path: string, asset: UpdateAsset, signal: AbortSignal, progress: (value: UpdateProgress) => void, requestFn: UpdateRequest, depth = 0): Promise<void> {
  signal.throwIfAborted();
  if (new URL(url).protocol !== 'https:') throw new Error('更新下载只允许 HTTPS 地址');
  const response = await requestFn(url, {
    method: 'GET', headers: { 'User-Agent': 'Win-Box-Updater' }, headersTimeout: 20_000, bodyTimeout: 30_000,
    signal, dispatcher: dispatchChain(url, agent)[0],
  });
  const location = response.headers.location;
  if (response.statusCode >= 300 && response.statusCode < 400 && location) {
    discardUpdateBody(response.body);
    if (depth >= 8) throw new Error('重定向次数过多');
    return downloadOne(new URL(String(location), url).href, path, asset, signal, progress, requestFn, depth + 1);
  }
  if (response.statusCode !== 200) { discardUpdateBody(response.body); throw new Error(`HTTP ${response.statusCode}`); }
  const reportedSize = response.headers['content-length'];
  if (reportedSize !== undefined && Number(reportedSize) !== asset.size) { discardUpdateBody(response.body); throw new Error('服务器报告的安装包大小与发布记录不符'); }
  let received = 0;
  const start = Date.now();
  let lastProgress = 0;
  const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    received += chunk.length;
    if (received > asset.size) { callback(new Error('安装包超过发布记录中的大小')); return; }
    const now = Date.now();
    if (now - lastProgress >= 300) {
      lastProgress = now;
      progress({ phase: 'downloading', received, total: asset.size, percent: Math.min(99, Math.floor(received * 100 / asset.size)), speed: Math.round(received * 1000 / Math.max(1, now - start)) });
    }
    callback(null, chunk);
  } });
  await pipeline(response.body, counter, createWriteStream(path, { flags: 'wx' }), { signal });
  if (received !== asset.size) throw new Error('安装包下载不完整');
  progress({ phase: 'verifying', received, total: asset.size, percent: 99, speed: 0, message: '正在校验安装包…' });
  await verifyUpdateFile(path, asset, signal);
}

/** Mirrors carry bytes only. A file is reusable or installable only after its trusted digest matches. */
export async function downloadVerifiedUpdate(asset: UpdateAsset, directory: string, urls: string[], signal: AbortSignal, progress: (value: UpdateProgress) => void, requestFn: UpdateRequest = request): Promise<string> {
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, asset.name);
  if (existsSync(destination)) {
    try { await verifyUpdateFile(destination, asset, signal); return destination; } catch { signal.throwIfAborted(); }
  }
  const partial = `${destination}.${randomUUID()}.part`;
  let lastError: unknown = new Error('没有可用下载线路');
  try {
    for (const url of urls) {
      signal.throwIfAborted();
      try {
        await downloadOne(url, partial, asset, signal, progress, requestFn);
        signal.throwIfAborted();
        renameSync(partial, destination);
        return destination;
      } catch (error) {
        rmSync(partial, { force: true });
        signal.throwIfAborted();
        lastError = error;
      }
    }
    throw lastError;
  } finally { rmSync(partial, { force: true }); }
}
