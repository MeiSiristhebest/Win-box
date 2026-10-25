// tests/pySpider.spec.ts — .py 蜘蛛（嵌入式 CPython3 宿主 PySpider）适配层单测
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PySpider } from '../src/engine/spider/PySpider';
import { SourceProblemError } from '../src/engine/spider/errors';
import { SpiderFactory } from '../src/engine/spider/SpiderFactory';
import { UnsupportedSpider } from '../src/engine/spider/UnsupportedSpider';
import type { EngineHost } from '../src/engine/ports';
import type { PythonSpiderRuntimePort } from '../src/engine/spider/PythonSpiderRuntimePort';
import type { PythonSpiderScriptLoadResult, PythonSpiderScriptPort } from '../src/engine/spider/PythonSpiderScriptPort';
import { NullLogger } from '../src/engine/util/logger';

const PY_SRC =
  '# -*- coding: utf-8 -*-\nclass Spider:\n    def init(self, ext):\n        pass\n    def homeContent(self, filter):\n        return {"class": [], "list": []}\n';

function makeHost(content: unknown): EngineHost {
  return {
    http: {
      request: async () => ({ status: 200, headers: {}, content, finalUrl: '' }),
    },
    kv: {},
    logger: NullLogger,
    driveTokens: () => ({ ali: 'TK' }),
  } as unknown as EngineHost;
}

function makeBridge(calls: { pyPath: string; cls: string; method: string; args: string[]; timeoutMs?: number }[], cacheDir: string): PythonSpiderRuntimePort {
  return {
    pyRuntimeReady: () => true,
    prewarmPythonRuntime: async () => cacheDir,
    prewarmPython: () => 0,
    callPython: async (pyPath: string, cls: string, method: string, args: string[], timeoutMs?: number) => {
      calls.push({ pyPath, cls, method, args, timeoutMs });
      return { ok: true, output: '{"list":[]}', reason: '', failureKind: null, problemCode: null };
    },
  };
}

function makeScripts(path = 'C:/cache/source.py', load: () => Promise<PythonSpiderScriptLoadResult> = async () => ({ status: 'ready', path })): PythonSpiderScriptPort {
  return { status: () => ({ path, available: true }), load };
}

const tmpDirs: string[] = [];
function tmpCache(): string {
  const d = mkdtempSync(join(tmpdir(), 'pyspider-'));
  tmpDirs.push(d);
  return join(d, 'py');
}
afterEach(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* 清理残留不阻塞断言 */
    }
  }
  tmpDirs.length = 0;
});

describe('SpiderFactory.createForSource — .py 分支', () => {
  const bean = (api: string) => ({ key: 'k', type: 3, api, ext: '', jar: '' });
  it('有 bridge → 返回 PySpider', () => {
    const f = new SpiderFactory({ pythonRuntime: {} as PythonSpiderRuntimePort, pythonScripts: makeScripts() });
    const sp = f.createForSource(bean('http://x/a.py') as never, makeHost([]));
    expect(sp).toBeInstanceOf(PySpider);
  });
  it('无 bridge → 降级 UnsupportedSpider', () => {
    const f = new SpiderFactory();
    const sp = f.createForSource(bean('http://x/a.py') as never, makeHost([]));
    expect(sp).toBeInstanceOf(UnsupportedSpider);
  });
});

describe('PySpider — 方法→callPython 的参数契约', () => {
  it('preserves a typed timeout from the runtime instead of relabeling it as missing Python', async () => {
    const cacheDir = tmpCache();
    const bridge: PythonSpiderRuntimePort = {
      pyRuntimeReady: () => true,
      prewarmPythonRuntime: async () => cacheDir,
      prewarmPython: () => 0,
      callPython: async () => ({
        ok: false,
        output: '',
        reason: '蜘蛛调用超时',
        failureKind: null,
        problemCode: 'SPIDER_TIMEOUT',
      }),
    };
    const sp = new PySpider({ key: 'py', api: 'https://x/a.py', ext: '', jar: '', host: makeHost(Array.from(Buffer.from(PY_SRC))) }, bridge, makeScripts());

    await expect(sp.homeContent(true)).rejects.toMatchObject({ code: 'SPIDER_TIMEOUT', message: '蜘蛛调用超时' });
  });

  it('preserves a typed missing-runtime error from the Python bridge', async () => {
    const cacheDir = tmpCache();
    const bridge: PythonSpiderRuntimePort = {
      pyRuntimeReady: () => true,
      prewarmPythonRuntime: async () => cacheDir,
      prewarmPython: () => 0,
      callPython: async () => { throw new SourceProblemError('PY_UNSUPPORTED', '嵌入式 Python 运行时缺失'); },
    };
    const sp = new PySpider({ key: 'py', api: 'https://x/a.py', ext: '', jar: '', host: makeHost(Array.from(Buffer.from(PY_SRC))) }, bridge, makeScripts());

    await expect(sp.homeContent(true)).rejects.toMatchObject({ code: 'PY_UNSUPPORTED' });
  });

  it('classifies an unexpected runtime execution exception as a spider error', async () => {
    const cacheDir = tmpCache();
    const bridge: PythonSpiderRuntimePort = {
      pyRuntimeReady: () => true,
      prewarmPythonRuntime: async () => cacheDir,
      prewarmPython: () => 0,
      callPython: async () => { throw new Error('runner protocol failed'); },
    };
    const sp = new PySpider({ key: 'py', api: 'https://x/a.py', ext: '', jar: '', host: makeHost(Array.from(Buffer.from(PY_SRC))) }, bridge, makeScripts());

    await expect(sp.homeContent(true)).rejects.toMatchObject({ code: 'SPIDER_ERROR', message: 'runner protocol failed' });
  });

  it('homeContent 调用 bridge.callPython(…, "homeContent", [ext])', async () => {
    const cacheDir = tmpCache();
    const calls: { pyPath: string; cls: string; method: string; args: string[] }[] = [];
    const bridge = makeBridge(calls, cacheDir);
    const sp = new PySpider({ key: 'py', api: 'https://x/a.py', ext: '{"siteUrl":"https://s"}', jar: '', host: makeHost(Array.from(Buffer.from(PY_SRC))) }, bridge, makeScripts());
    await sp.homeContent(true);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('homeContent');
    const sent = JSON.parse(calls[0].args[0]) as Record<string, string>; // ext 并入网盘 token
    expect(sent.siteUrl).toBe('https://s');
    expect(sent.ali).toBe('TK');
  });

  it('defaults to the configured source timeout and preserves a tighter caller budget', async () => {
    const cacheDir = tmpCache();
    const calls: { pyPath: string; cls: string; method: string; args: string[]; timeoutMs?: number }[] = [];
    const bridge = makeBridge(calls, cacheDir);
    const spider = new PySpider({
      key: 'py',
      api: 'https://x/a.py',
      ext: '',
      jar: '',
      timeoutMs: 4321,
      host: makeHost(Array.from(Buffer.from(PY_SRC))),
    }, bridge, makeScripts());

    await spider.homeContent(true);
    await spider.searchContent('query', false, 1250);

    expect(calls.map(call => call.timeoutMs)).toEqual([4321, 1250]);
  });

  it('className 缺省 Spider；name= 可覆盖', async () => {
    const cacheDir = tmpCache();
    const calls: { cls: string }[] = [];
    const bridge = makeBridge(calls as never, cacheDir);
    const a = new PySpider({ key: 'a', api: 'https://x/a.py', ext: '', jar: '', host: makeHost(Array.from(Buffer.from(PY_SRC))) }, bridge, makeScripts());
    await a.homeContent(true);
    expect(calls[0].cls).toBe('Spider');
    const b = new PySpider({ key: 'b', api: 'https://x/b.py?name=Spider2', ext: '', jar: '', host: makeHost(Array.from(Buffer.from(PY_SRC))) }, bridge, makeScripts());
    await b.homeContent(true);
    expect(calls[1].cls).toBe('Spider2');
  });

  it('脚本下载失败 → 直接抛错（A1，不再静默返回空串）', async () => {
    const cacheDir = tmpCache();
    const calls: unknown[] = [];
    const bridge = makeBridge(calls as never, cacheDir);
    const scripts = makeScripts('C:/cache/source.py', async () => ({ status: 'failed', code: 'SCRIPT_DOWNLOAD_FAILED', detail: 'connect timeout' }));
    const sp = new PySpider({ key: 'py', api: 'https://x/a.py', ext: '', jar: '', host: makeHost([]) }, bridge, scripts);
    await expect(sp.homeContent(true)).rejects.toThrow(/加载失败/);
    expect(calls.length).toBe(0);
  });

  it('cancels one search waiter without cancelling a shared script download for another call', async () => {
    const cacheDir = tmpCache();
    const calls: unknown[] = [];
    const bridge = makeBridge(calls as never, cacheDir);
    let finishDownload!: () => void;
    const scripts = makeScripts('C:/cache/shared.py', () => new Promise(resolve => { finishDownload = () => resolve({ status: 'ready', path: 'C:/cache/shared.py' }); }));
    const spider = new PySpider({ key: 'py', api: 'https://x/shared.py', ext: '', jar: '', host: makeHost([]) }, bridge, scripts);
    const controller = new AbortController();
    const cancelledSearch = spider.searchContent('old query', false, 1000, controller.signal);
    const activeSearch = spider.searchContent('current query', false, 1000);

    controller.abort(new Error('query superseded'));
    await expect(cancelledSearch).rejects.toMatchObject({ name: 'AbortError' });

    finishDownload();
    await expect(activeSearch).resolves.toBe('{"list":[]}');
    expect(calls).toHaveLength(1);
  });

  it('非 http 脚本地址 → 直接抛错（不下载）', async () => {
    const cacheDir = tmpCache();
    const calls: unknown[] = [];
    const bridge = makeBridge(calls as never, cacheDir);
    const sp = new PySpider({ key: 'py', api: './a.py', ext: '', jar: '', host: makeHost([]) }, bridge, makeScripts('C:/cache/source.py', async () => ({ status: 'failed', code: 'INVALID_ADDRESS' })));
    await expect(sp.homeContent(true)).rejects.toThrow(/不是 http\(s\)/);
    expect(calls.length).toBe(0);
  });

  it('category/detail/searchContentPage 参数契约', async () => {
    const cacheDir = tmpCache();
    const calls: { method: string; args: string[] }[] = [];
    const bridge = makeBridge(calls as never, cacheDir);
    const sp = new PySpider({ key: 'py', api: 'https://x/a.py', ext: '', jar: '', host: makeHost(Array.from(Buffer.from(PY_SRC))) }, bridge, makeScripts());
    await sp.categoryContent('1', '2', true, { f1: 'v1' });
    await sp.detailContent(['id1', 'id2']);
    await sp.searchContent('kw', false);
    await sp.searchContentPage('kw', true, '3');
    expect(calls[0].method).toBe('categoryContent');
    expect(calls[0].args[1]).toBe('1');
    expect(calls[0].args[2]).toBe('2');
    expect(JSON.parse(calls[0].args[3])).toEqual({ f1: 'v1' });
    expect(calls[1].method).toBe('detailContent');
    expect(JSON.parse(calls[1].args[1])).toEqual(['id1', 'id2']);
    expect(calls[2].method).toBe('searchContent');
    expect(calls[2].args.slice(1)).toEqual(['kw', 'false']);
    expect(calls[3].method).toBe('searchContent');
    expect(calls[3].args.slice(1)).toEqual(['kw', 'true', '3']);
  });
});
