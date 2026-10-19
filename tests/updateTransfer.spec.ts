import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'undici';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { downloadVerifiedUpdate, verifyUpdateFile } from '../src/main/update/updateTransfer';
import { trustedUpdateAsset, UPDATE_REPO, type UpdateAsset } from '../src/shared/update';

vi.mock('../src/main/net/proxy', () => ({ dispatchChain: () => [undefined] }));

const payload = Buffer.from('MZ installer fixture bytes');
const asset: UpdateAsset = {
  id: 123, sha256: createHash('sha256').update(payload).digest('hex'), name: 'Setup.exe',
  url: `https://github.com/${UPDATE_REPO}/releases/download/release9.0.0/Setup.exe`, size: payload.length, accelUrls: [],
};
let base = '';
const hits: string[] = [];
let onStall: (() => void) | undefined;
const server = createServer((incoming, response) => {
  const path = incoming.url || '/';
  hits.push(path);
  if (path === '/stall') { response.writeHead(200); response.write(payload.subarray(0, 4)); onStall?.(); return; }
  if (path === '/redirect') { response.writeHead(302, { location: 'https://mirror.test/good' }); response.end(); return; }
  if (path === '/insecure') { response.writeHead(302, { location: 'http://mirror.test/good' }); response.end(); return; }
  const bytes = path === '/bad' ? Buffer.alloc(payload.length, 1) : path === '/short' ? Buffer.from('short') : payload;
  response.writeHead(200, { 'content-length': bytes.length });
  response.end(bytes);
});
const localRequest: typeof request = (url, options) => request(base + new URL(String(url)).pathname, { ...options, dispatcher: undefined });
const directories: string[] = [];
function directory() { const path = mkdtempSync(join(tmpdir(), 'winbox-update-')); directories.push(path); return path; }

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address missing');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(() => { directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); hits.length = 0; onStall = undefined; });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

describe('authenticated update assets', () => {
  const raw = { id: asset.id, name: asset.name, browser_download_url: asset.url, size: asset.size, digest: `sha256:${asset.sha256}` };
  it('uses only a digest associated with an asset of the configured repository', () => {
    expect(trustedUpdateAsset(raw, 'release9.0.0')).toMatchObject({ id: asset.id, sha256: asset.sha256 });
    expect(() => trustedUpdateAsset({ ...raw, digest: null }, 'release9.0.0')).toThrow('SHA-256');
    expect(() => trustedUpdateAsset({ ...raw, browser_download_url: raw.browser_download_url.replace(UPDATE_REPO, 'other/repository') }, 'release9.0.0')).toThrow('当前仓库');
    expect(() => trustedUpdateAsset({ ...raw, name: '../outside.exe' }, 'release9.0.0')).toThrow('文件名');
    expect(() => trustedUpdateAsset({ ...raw, id: 0 }, 'release9.0.0')).toThrow('标识');
  });
});

describe('verified streaming downloads with real HTTP fixtures', () => {
  it('rejects equal-length corrupt bytes and falls back to the next mirror', async () => {
    const path = directory();
    const progress = vi.fn();
    const result = await downloadVerifiedUpdate(asset, path, ['https://mirror.test/bad', 'https://mirror.test/good'], new AbortController().signal, progress, localRequest);
    expect(readFileSync(result)).toEqual(payload);
    expect(hits).toEqual(['/bad', '/good']);
    expect(readdirSync(path)).toEqual([asset.name]);
    expect(progress.mock.calls.some(([value]) => value.phase === 'verifying')).toBe(true);
  });

  it('refuses wrong sizes and leaves no partial or installable file', async () => {
    const path = directory();
    await expect(downloadVerifiedUpdate(asset, path, ['https://mirror.test/short'], new AbortController().signal, vi.fn(), localRequest)).rejects.toThrow('大小');
    expect(readdirSync(path)).toEqual([]);
  });

  it('hashes cached files before reuse and replaces equal-length corruption', async () => {
    const path = directory();
    writeFileSync(join(path, asset.name), Buffer.alloc(payload.length));
    const result = await downloadVerifiedUpdate(asset, path, ['https://mirror.test/good'], new AbortController().signal, vi.fn(), localRequest);
    expect(readFileSync(result)).toEqual(payload);
    await downloadVerifiedUpdate(asset, path, ['https://mirror.test/good'], new AbortController().signal, vi.fn(), localRequest);
    expect(hits).toEqual(['/good']);
    writeFileSync(result, Buffer.alloc(payload.length));
    await expect(verifyUpdateFile(result, asset)).rejects.toThrow('SHA-256');
  });

  it('cancels a stalled stream and removes its partial file', async () => {
    const path = directory();
    const controller = new AbortController();
    const began = new Promise<void>(resolve => { onStall = resolve; });
    const transfer = downloadVerifiedUpdate(asset, path, ['https://mirror.test/stall'], controller.signal, vi.fn(), localRequest);
    const rejected = expect(transfer).rejects.toThrow('cancel fixture');
    await began;
    controller.abort(new Error('cancel fixture'));
    await rejected;
    expect(readdirSync(path)).toEqual([]);
  });

  it('follows HTTPS redirects and rejects downgrade to HTTP', async () => {
    const path = directory();
    await expect(downloadVerifiedUpdate(asset, path, ['https://mirror.test/insecure'], new AbortController().signal, vi.fn(), localRequest)).rejects.toThrow('HTTPS');
    expect(hits).toEqual(['/insecure']);
    const result = await downloadVerifiedUpdate(asset, path, ['https://mirror.test/redirect'], new AbortController().signal, vi.fn(), localRequest);
    expect(readFileSync(result)).toEqual(payload);
  });
});
