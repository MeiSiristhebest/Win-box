import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { buildZip } from '../src/engine/util/syncZip';
import type { EngineHost } from '../src/engine/ports';
import { Spider, isSpiderOperationImplemented } from '../src/engine/spider/Spider';
import { SpiderFactory } from '../src/engine/spider/SpiderFactory';
import { boundedJsonClone, validatePluginManifest, type PluginManifest, type SpiderRuntimeContribute, type SpiderRuntimeOperation } from '../src/shared/plugin';
import { PluginHost } from '../src/main/plugin/PluginHost';
import { PluginSandbox, type PluginSandboxOptions, type PluginWorkerPort } from '../src/main/plugin/sandbox/PluginSandbox';
import { buildWinbox, type SpiderRuntimeHandler } from '../src/main/plugin/sandbox/buildWinbox';
import type { PluginSandboxApi, PluginWorkerData, PluginWorkerMessage, SpiderRuntimeHostRequest } from '../src/main/plugin/sandbox/protocol';
import type { Logger, SourceBean } from '../src/shared/types';

const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'plugin-examples');
const fixtureManifest = JSON.parse(readFileSync(join(fixtureDir, 'plugin.spider-runtime.json'), 'utf8')) as PluginManifest;
const fixtureScript = readFileSync(join(fixtureDir, 'main.spider-runtime.js'), 'utf8');
const runtimeContribution = fixtureManifest.contributes[0] as unknown as SpiderRuntimeContribute;
const noopLogger = { i: (): void => undefined, w: (): void => undefined, e: (): void => undefined } as unknown as Logger;
const fakeApi = {} as PluginSandboxApi;
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Spider runtime manifest consent and contribution validation', () => {
  it('accepts the fixture only with explicit spider.runtime permission', () => {
    expect(validatePluginManifest(fixtureManifest)).toEqual({ ok: true });
    expect(validatePluginManifest({ ...fixtureManifest, permissions: [] }).reasonCode).toBe('KIND_PERM_MISMATCH');
    expect(validatePluginManifest({
      ...fixtureManifest,
      contributes: [{ ...runtimeContribution, apiPrefix: 'fixture *' }],
    }).reasonCode).toBe('SPIDER_RUNTIME_INVALID');
  });

  it('only registers manifest-declared handlers when permission is present', () => {
    const descriptors = [runtimeContribution];
    const allowed = buildWinbox(['spider.runtime'], async () => undefined, descriptors);
    expect(typeof (allowed.winbox.spider as { register: unknown }).register).toBe('function');
    expect(() => (allowed.winbox.spider as { register: (id: string, value: unknown) => void }).register('other', {})).toThrow('未在 plugin.json 声明');

    const denied = buildWinbox([], async () => undefined, descriptors);
    expect(denied.winbox.spider).toBeUndefined();
    expect(denied.spiderHandlers.size).toBe(0);
  });
});

class FakeWorker implements PluginWorkerPort {
  readonly messages: Array<PluginWorkerMessage | SpiderRuntimeHostRequest> = [];
  private readonly listeners = new Map<string, Array<(value: never) => void>>();
  private readonly active = new Map<number, AbortController>();
  terminated = false;

  constructor(readonly data: PluginWorkerData) {
    queueMicrotask(() => this.emit('message', { t: 'ready' } as PluginWorkerMessage));
  }

  on(event: 'message' | 'error' | 'exit', listener: ((message: PluginWorkerMessage) => void) | ((error: Error) => void) | ((code: number) => void)): this {
    const current = this.listeners.get(event) ?? [];
    current.push(listener as (value: never) => void);
    this.listeners.set(event, current);
    return this;
  }

  postMessage(value: unknown): void {
    const message = value as PluginWorkerMessage | SpiderRuntimeHostRequest;
    this.messages.push(message);
    if (message.t === 'spider.cancel') {
      this.active.get(message.id)?.abort();
      this.active.delete(message.id);
      return;
    }
    if (message.t !== 'spider.invoke') return;
    const input = message.input as { args?: { key?: string } };
    if (input.args?.key === 'wait') {
      this.active.set(message.id, new AbortController());
      return;
    }
    queueMicrotask(() => this.emit('message', {
      t: 'spider.result',
      id: message.id,
      ok: input.args?.key !== 'fail',
      value: input.args?.key === 'large-result'
        ? JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) })
        : JSON.stringify({ key: input.args?.key }),
      error: input.args?.key === 'fail' ? 'fixture failure' : undefined,
    } as PluginWorkerMessage));
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    return 0;
  }

  private emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (value: unknown) => void)(value);
  }
}

function pluginSandboxOptions(workerFactory: (code: string, data: PluginWorkerData) => PluginWorkerPort): PluginSandboxOptions {
  return {
    pluginId: 'fixture-spider-plugin',
    pluginDir: fixtureDir,
    mainFile: 'main.spider-runtime.js',
    permissions: ['spider.runtime'],
    spiderRuntimes: [runtimeContribution],
    api: fakeApi,
    workerFile: 'unused-worker.cjs',
    logger: noopLogger,
    code: 'unused',
    workerFactory,
  };
}

describe('PluginSandbox host-initiated Spider RPC', () => {
  it('bounds requests, returns replies/errors, cancels by signal, and disposes pending calls', async () => {
    const workers: FakeWorker[] = [];
    const sandbox = new PluginSandbox(pluginSandboxOptions((_code, data) => {
      const worker = new FakeWorker(data);
      workers.push(worker);
      return worker;
    }));
    expect((await sandbox.start()).ok).toBe(true);
    expect(JSON.parse(String(await sandbox.invokeSpider('fixture-spider', 'searchContent', { args: { key: 'good' } })))).toEqual({ key: 'good' });
    await expect(sandbox.invokeSpider('fixture-spider', 'searchContent', { args: { key: 'fail' } })).rejects.toThrow('fixture failure');
    await expect(sandbox.invokeSpider('fixture-spider', 'searchContent', { args: { key: 'x'.repeat(300_000) } })).rejects.toThrow('大小限制');
    await expect(sandbox.invokeSpider('fixture-spider', 'searchContent', { args: { key: 'large-result' } })).rejects.toThrow('大小限制');

    const controller = new AbortController();
    const canceled = sandbox.invokeSpider('fixture-spider', 'searchContent', { args: { key: 'wait' } }, 2_000, controller.signal);
    controller.abort('caller canceled');
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].messages.some((message) => message.t === 'spider.cancel')).toBe(true);

    const timed = sandbox.invokeSpider('fixture-spider', 'searchContent', { args: { key: 'wait' } }, 10);
    await expect(timed).rejects.toThrow('超时');

    const pending = sandbox.invokeSpider('fixture-spider', 'searchContent', { args: { key: 'wait' } }, 2_000);
    sandbox.dispose();
    await expect(pending).rejects.toThrow('已释放');
    expect(workers[0].terminated).toBe(true);
  });
});

class FixtureSandbox {
  readonly options: PluginSandboxOptions;
  running = false;
  error: string | undefined;
  disposed = false;
  private handlers = new Map<string, Partial<Record<SpiderRuntimeOperation, SpiderRuntimeHandler>>>();
  private calls = new Set<AbortController>();

  constructor(options: PluginSandboxOptions) { this.options = options; }

  async start(): Promise<{ ok: boolean }> {
    const winbox = buildWinbox(this.options.permissions, async () => undefined, this.options.spiderRuntimes);
    const context = createContext(winbox.globals);
    const run = `(async () => {\n${fixtureScript}\n})()`;
    await runInContext(run, context, { filename: 'main.spider-runtime.js', timeout: 1_000 }) as Promise<unknown>;
    this.handlers = winbox.spiderHandlers;
    this.running = true;
    return { ok: true };
  }

  async invokeSpider(providerId: string, operation: SpiderRuntimeOperation, input: unknown, _timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const handler = this.handlers.get(providerId)?.[operation];
    if (!handler) throw new Error(`handler missing: ${providerId}.${operation}`);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    this.calls.add(controller);
    try {
      return await handler(boundedJsonClone(input, 256 * 1024), { signal: controller.signal });
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.calls.delete(controller);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    for (const controller of this.calls) controller.abort(new Error('fixture disposed'));
    this.calls.clear();
  }
}

const spiderHost = { http: {}, kv: {}, logger: noopLogger } as unknown as EngineHost;

describe('installed Spider runtime provider', () => {
  it('installs a local fixture, dispatches Spider calls, reports failures/cancellation, and retires on disable/uninstall', async () => {
    const root = mkdtempSync(join(tmpdir(), 'winbox-spider-runtime-'));
    tempRoots.push(root);
    const pluginsDir = join(root, 'plugins');
    const builtinDir = join(root, 'builtin');
    const manifestPath = join(root, 'plugin.spider-runtime.json');
    writeFileSync(manifestPath, JSON.stringify(fixtureManifest));
    const packagePath = join(root, 'fixture.winbox');
    writeFileSync(packagePath, buildZip([
      { name: 'plugin.json', bytes: Buffer.from(JSON.stringify(fixtureManifest)) },
      { name: 'main.js', bytes: Buffer.from(fixtureScript) },
    ]));

    const boxes: FixtureSandbox[] = [];
    const host = new PluginHost({ pluginsDir, builtinDir, statePath: join(root, 'plugin-state.json') });
    host.attachSandbox({
      api: fakeApi,
      workerFile: 'fixture-worker.cjs',
      logger: noopLogger,
      factory: (options) => {
        const box = new FixtureSandbox(options);
        boxes.push(box);
        return box;
      },
    });
    await host.init();
    expect((await host.installFromFile(packagePath)).ok).toBe(true);
    const provider = host.spiderRuntimeProvider();
    const source = { key: 'fixture', type: 3, api: 'fixture-spider://catalog', ext: '', jar: '' } as SourceBean;
    expect(provider.supports(source)).toBe(true);
    const factory = new SpiderFactory({ runtimeProviders: [provider] });
    const spider = factory.createForSource(source, spiderHost);
    expect(spider).toBeInstanceOf(Spider);
    expect(isSpiderOperationImplemented(spider, 'searchContent')).toBe(true);
    expect(JSON.parse(await spider.searchContent('Snowfall', false))).toEqual({ list: [{ vod_name: 'Snowfall', api: source.api }] });
    expect(JSON.parse(await spider.detailContent(['episode-1']))).toEqual({ list: [{ vod_id: 'episode-1' }] });
    await expect(spider.searchContent('fail', false)).rejects.toThrow('fixture Spider failure');

    const abort = new AbortController();
    const canceled = spider.searchContent('wait', false, 5_000, abort.signal);
    abort.abort();
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });

    const inFlightReplacement = spider.searchContent('wait', false, 5_000);
    const replacedBox = boxes.at(-1)!;
    const updatedManifest = { ...fixtureManifest, version: '2.0.0' };
    const updatePath = join(root, 'fixture-v2.winbox');
    writeFileSync(updatePath, buildZip([
      { name: 'plugin.json', bytes: Buffer.from(JSON.stringify(updatedManifest)) },
      { name: 'main.js', bytes: Buffer.from(fixtureScript) },
    ]));
    expect((await host.installFromFile(updatePath)).ok).toBe(true);
    await expect(inFlightReplacement).rejects.toThrow('fixture canceled');
    expect(replacedBox.disposed).toBe(true);
    expect(boxes.at(-1)).not.toBe(replacedBox);
    expect(JSON.parse(await spider.searchContent('after-update', false))).toEqual({ list: [{ vod_name: 'after-update', api: source.api }] });

    const inFlight = spider.searchContent('wait', false, 5_000);
    const oldBox = boxes.at(-1)!;
    expect((await host.setEnabled(fixtureManifest.id, false)).ok).toBe(true);
    await expect(inFlight).rejects.toThrow('fixture canceled');
    expect(oldBox.disposed).toBe(true);
    expect(provider.supports(source)).toBe(false);
    expect(await spider.searchContent('disabled', false)).toBe('');

    expect((await host.uninstall(fixtureManifest.id)).ok).toBe(true);
    expect(boxes.every((box) => box.disposed)).toBe(true);
    expect(provider.supports(source)).toBe(false);
  });
});
