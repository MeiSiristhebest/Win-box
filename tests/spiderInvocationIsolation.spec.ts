import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JarSpiderBridge } from '../src/engine/spider/JarSpiderBridge';
import { EmbeddedPythonRuntime } from '../src/engine/spider/EmbeddedPythonRuntime';
import { JarSpider } from '../src/engine/spider/JarSpider';
import { PySpider } from '../src/engine/spider/PySpider';
import { SpiderSourceRuntimeAdapter } from '../src/engine/spider/SpiderSourceRuntimeAdapter';
import { SpiderSourceAdapter } from '../src/engine/vod/SpiderSourceAdapter';
import type { EngineHost } from '../src/engine/ports';
import { NullLogger } from '../src/engine/util/logger';
import * as spiderPool from '../src/engine/spider/SpiderProcPool';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

function childProcess(executable: string) {
  return Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stdin: { writable: true, write: vi.fn((_line: string) => true) },
    kill: vi.fn(), executable,
  });
}
const roots: string[] = [];
const bridges: JarSpiderBridge[] = [];
afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  vi.restoreAllMocks();
  spawn.mockReset();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('winbox-spider-invocation-')) {
      throw new Error(`Refusing cleanup outside the invocation fixture root: ${root}`);
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'winbox-spider-invocation-'));
  roots.push(root);
  mkdirSync(join(root, 'jre/bin'), { recursive: true });
  writeFileSync(join(root, 'jre/bin/java.exe'), 'fixture');
  const bridge = new JarSpiderBridge({ jvmDir: root, cacheDir: join(root, 'converted'), pyRuntimeDir: join(root, 'python') });
  bridges.push(bridge);
  const children: ReturnType<typeof childProcess>[] = [];
  spawn.mockImplementation((executable: string) => {
    const child = childProcess(executable); children.push(child); return child;
  });
  const host: EngineHost = {
    http: { request: async () => ({ status: 200, content: '', headers: {}, finalUrl: '' }) },
    kv: { get: () => '', set: () => undefined, delete: () => undefined },
    logger: NullLogger,
  };
  const artifact = join(root, 'fixture.jar');
  vi.spyOn(bridge, 'ensureConverted').mockResolvedValue(artifact);
  vi.spyOn(bridge, 'resolvePaths').mockReturnValue([artifact]);
  vi.spyOn(EmbeddedPythonRuntime.prototype, 'ensure').mockResolvedValue(join(root, 'python'));
  const jar = new JarSpider({ key: 'jar', api: 'csp_A', ext: '', jar: 'https://fixture.invalid/a.jar', host }, bridge);
  const pythonPath = join(root, 'source.py');
  writeFileSync(pythonPath, 'class Spider: pass');
  const pythonScripts = {
    status: () => ({ path: pythonPath, available: true }),
    load: async () => ({ status: 'ready' as const, path: pythonPath }),
  };
  const python = new PySpider({ key: 'py', api: pathToFileURL(pythonPath).href, ext: '', jar: '', host }, bridge, pythonScripts);
  return { bridge, children, jar, python, artifact, host };
}

function complete(child: ReturnType<typeof childProcess>, output: string, error = '') {
  if (output) child.stdout.emit('data', Buffer.from(output));
  if (error) child.stderr.emit('data', Buffer.from(`[SpiderRunner.ERROR] ${error}`));
  const code = error ? 1 : 0;
  child.emit('exit', code, null);
  child.emit('close', code);
}

describe('spider invocation result isolation', () => {
  it.each(['jar', 'python'])('keeps %s pool envelopes isolated from other replies and uncorrelated stderr', async (runtime) => {
    vi.spyOn(spiderPool, 'poolEnabled').mockReturnValue(true);
    const { bridge, children, artifact } = fixture();
    const invoke = () => runtime === 'jar'
      ? bridge.call([artifact], 'fixture.A', 'searchContent', [])
      : bridge.callPython('source.py', 'Spider', 'searchContent', []);
    const pending = Promise.all([invoke(), invoke()]);
    await vi.waitFor(() => {
      expect(children).toHaveLength(1);
      expect(children[0].stdin.write).toHaveBeenCalledTimes(2);
    });
    const [first, second] = children[0].stdin.write.mock.calls.map(([line]) => JSON.parse(line) as { id: string });
    children[0].stderr.emit('data', '[android.Log.D] SpiderLog: UNRELATED_SOURCE_FAILED\n');
    children[0].stdout.emit('data', JSON.stringify({ id: second.id, ok: false, data: 'SECOND_POOL_CALL_FAILED' }) + '\n');
    children[0].stdout.emit('data', JSON.stringify({ id: first.id, ok: true, data: '' }) + '\n');
    const [empty, failed] = await pending;
    expect(empty).toEqual({ ok: true, output: '', reason: '', failureKind: null, problemCode: null });
    expect(failed).toMatchObject({ ok: false, output: '', reason: expect.stringContaining('SECOND_POOL_CALL_FAILED') });
    expect(failed.reason).not.toContain('UNRELATED_SOURCE_FAILED');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('reports each concurrent query failure with its own reason at the VOD boundary', async () => {
    const { jar, children, host } = fixture();
    const adapter = new SpiderSourceAdapter(new SpiderSourceRuntimeAdapter({ createForSource: () => jar }, host), NullLogger);
    const source = {
      key: 'jar', name: 'fixture', type: 3, api: 'csp_A', ext: '', jar: '',
      searchable: 1, quickSearch: 1, changeable: 1, filterable: 1, playUrl: '',
      playerType: -1, categories: null, timeout: 0, click: '', style: '',
    };
    const pending = Promise.allSettled([
      adapter.search(source, 'first', false, 1000),
      adapter.search(source, 'second', false, 1000),
    ]);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    complete(children[0], '', 'FIRST_QUERY_ONLY_FAILED');
    complete(children[1], '', 'SECOND_QUERY_ONLY_FAILED');
    const [first, second] = await pending;
    expect(first).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('FIRST_QUERY_ONLY_FAILED') } });
    expect(second).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('SECOND_QUERY_ONLY_FAILED') } });
  });

  it('returns diagnostics with each concurrent bridge call, including a legal empty result', async () => {
    const { bridge, children, artifact } = fixture();
    const pending = Promise.all([
      bridge.call([artifact], 'fixture.A', 'searchContent', []),
      bridge.call([artifact], 'fixture.B', 'searchContent', []),
    ]);
    expect(children).toHaveLength(2);
    complete(children[0], '', 'ONLY_A_FAILED');
    complete(children[1], '');
    const [failed, empty] = await pending;
    expect(failed).toMatchObject({ ok: false, output: '', reason: expect.stringContaining('ONLY_A_FAILED') });
    expect(empty).toMatchObject({ ok: true, output: '', reason: '', failureKind: null });
  });

  it('keeps failures from two methods of the same JAR source separate', async () => {
    const { jar, children } = fixture();
    const pending = Promise.allSettled([jar.homeContent(true), jar.searchContent('movie', false)]);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    complete(children[0], '', 'HOME_ONLY_FAILED');
    complete(children[1], '', 'SEARCH_ONLY_FAILED');
    const [home, search] = await pending;
    expect(home).toMatchObject({ status: 'rejected', reason: { code: 'SPIDER_ERROR', message: expect.stringContaining('HOME_ONLY_FAILED') } });
    expect(search).toMatchObject({ status: 'rejected', reason: { code: 'SPIDER_ERROR', message: expect.stringContaining('SEARCH_ONLY_FAILED') } });
  });

  it('does not let a Python success erase a concurrent JAR failure', async () => {
    const { jar, python, children } = fixture();
    const pending = Promise.allSettled([jar.searchContent('movie', false), python.searchContent('movie', false)]);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    complete(children.find(child => child.executable.endsWith('java.exe'))!, '', 'JAR_ONLY_FAILED');
    complete(children.find(child => child.executable.endsWith('python.exe'))!, '{"list":[]}');
    const [failed, successful] = await pending;
    expect(failed).toMatchObject({ status: 'rejected', reason: { code: 'SPIDER_ERROR', message: expect.stringContaining('JAR_ONLY_FAILED') } });
    expect(successful).toEqual({ status: 'fulfilled', value: '{"list":[]}' });
  });

  it('keeps a Python execution failure distinct from missing runtime and from another call', async () => {
    const { python, children } = fixture();
    const pending = Promise.allSettled([python.homeContent(true), python.searchContent('movie', false)]);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    complete(children[1], '', 'PYTHON_SEARCH_ONLY_FAILED');
    complete(children[0], '{"list":[]}');
    const [home, search] = await pending;
    expect(home).toEqual({ status: 'fulfilled', value: '{"list":[]}' });
    expect(search).toMatchObject({ status: 'rejected', reason: { code: 'SPIDER_ERROR', message: expect.stringContaining('PYTHON_SEARCH_ONLY_FAILED') } });
  });
});
