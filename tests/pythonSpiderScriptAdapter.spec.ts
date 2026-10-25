import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HttpClient } from '../src/shared/types';
import { PythonSpiderScriptAdapter } from '../src/main/spider/PythonSpiderScriptAdapter';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(http: HttpClient) {
  const root = mkdtempSync(join(tmpdir(), 'python-spider-script-'));
  roots.push(root);
  const cacheDirectory = join(root, 'py-cache');
  return { root, cacheDirectory, adapter: new PythonSpiderScriptAdapter({ cacheDirectory, http }) };
}

function response(bytes: Buffer) {
  return { status: 200, headers: {}, content: Array.from(bytes), finalUrl: '' };
}

describe('PythonSpiderScriptAdapter', () => {
  it('downloads a remote script once and reuses the cached file', async () => {
    const http = { request: vi.fn(async () => response(Buffer.from('class Spider: pass\n'))) } as unknown as HttpClient;
    const { adapter } = fixture(http);

    const first = await adapter.load('https://example.invalid/spider.py');
    const second = await adapter.load('https://example.invalid/spider.py');

    expect(first).toEqual(second);
    expect(first.status).toBe('ready');
    if (first.status === 'ready') {
      expect(existsSync(first.path)).toBe(true);
      expect(readFileSync(first.path, 'utf8')).toBe('class Spider: pass\n');
      expect(adapter.status('https://example.invalid/spider.py')).toEqual({ path: first.path, available: true });
    }
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent downloads for the same script URL', async () => {
    let complete!: (value: ReturnType<typeof response>) => void;
    const http = { request: vi.fn(() => new Promise(resolve => { complete = resolve; })) } as unknown as HttpClient;
    const { adapter } = fixture(http);

    const first = adapter.load('https://example.invalid/shared.py');
    const second = adapter.load('https://example.invalid/shared.py');
    expect(http.request).toHaveBeenCalledTimes(1);
    complete(response(Buffer.from('class Spider: pass\n')));

    const [loadedFirst, loadedSecond] = await Promise.all([first, second]);
    expect(loadedFirst).toEqual(loadedSecond);
    expect(loadedFirst.status).toBe('ready');
  });

  it('uses file URLs directly and reports missing local or invalid scripts', async () => {
    const http = { request: vi.fn() } as unknown as HttpClient;
    const { root, adapter } = fixture(http);
    const localScript = join(root, 'local.py');
    writeFileSync(localScript, 'class Spider: pass\n');

    expect(await adapter.load(pathToFileURL(localScript).href)).toEqual({ status: 'ready', path: localScript });
    expect(await adapter.load(pathToFileURL(join(root, 'missing.py')).href)).toEqual({
      status: 'failed', code: 'LOCAL_SCRIPT_MISSING',
    });
    expect(await adapter.load('./relative.py')).toEqual({ status: 'failed', code: 'INVALID_ADDRESS' });
    expect(await adapter.load('file://%')).toEqual({ status: 'failed', code: 'INVALID_FILE_URL', detail: 'file://%' });
    expect(http.request).not.toHaveBeenCalled();
  });

  it('rejects empty payloads and surfaces download errors as typed outcomes', async () => {
    const { adapter: emptyAdapter } = fixture({ request: vi.fn(async () => response(Buffer.from('tiny'))) } as unknown as HttpClient);
    expect(await emptyAdapter.load('https://example.invalid/empty.py')).toEqual({ status: 'failed', code: 'SCRIPT_EMPTY' });

    const { adapter: failedAdapter } = fixture({ request: vi.fn(async () => { throw new Error('connect timeout'); }) } as unknown as HttpClient);
    expect(await failedAdapter.load('https://example.invalid/fail.py')).toEqual({
      status: 'failed', code: 'SCRIPT_DOWNLOAD_FAILED', detail: 'connect timeout',
    });
  });
});
