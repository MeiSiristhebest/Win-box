import { describe, expect, it } from 'vitest';
import type { Logger } from '../src/shared/types';
import type { PluginSandboxView } from '../src/shared/plugin';
import { PluginSandboxLifecycle, type SandboxEntry } from '../src/main/plugin/sandbox/PluginSandboxLifecycle';
import { PluginSandbox, type PluginSandboxOptions, type SandboxLike } from '../src/main/plugin/sandbox/PluginSandbox';
import type { PluginSandboxApi } from '../src/main/plugin/sandbox/protocol';

type StartResult = { ok: boolean; error?: string };

class DeferredSandbox implements SandboxLike {
  running = false;
  error: string | undefined;
  disposed = false;
  starts = 0;
  private completeStart?: (result: StartResult) => void;

  constructor(readonly opts: PluginSandboxOptions, private readonly result?: StartResult) {}

  start(): Promise<StartResult> {
    this.starts += 1;
    if (this.result) {
      this.running = this.result.ok;
      this.error = this.result.error;
      return Promise.resolve(this.result);
    }
    return new Promise((resolve) => {
      this.completeStart = (result) => {
        this.running = result.ok;
        this.error = result.error;
        resolve(result);
      };
    });
  }

  finish(result: StartResult): void {
    this.completeStart?.(result);
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
  }
}

const logger = {
  i: (): void => undefined,
  w: (): void => undefined,
  e: (): void => undefined,
} as unknown as Logger;

const api = {} as PluginSandboxApi;

function entry(overrides: Partial<SandboxEntry> = {}): SandboxEntry {
  return {
    id: 'example',
    enabled: true,
    kind: 'code',
    payloadReady: true,
    path: 'plugins/example.winbox',
    main: 'main.js',
    version: '1.0.0',
    contentFingerprint: 'sha256:one',
    permissions: ['log'],
    ...overrides,
  };
}

function lifecycle(factory: (options: PluginSandboxOptions) => SandboxLike): PluginSandboxLifecycle {
  return new PluginSandboxLifecycle({ api, workerFile: 'unused-worker.cjs', logger, factory });
}

describe('PluginSandboxLifecycle', () => {
  it('同一身份保持单实例；版本、入口、权限或载荷内容变化都会替换', async () => {
    const boxes: DeferredSandbox[] = [];
    const manager = lifecycle((options) => {
      const box = new DeferredSandbox(options, { ok: true });
      boxes.push(box);
      return box;
    });

    let current = entry();
    await manager.sync([current]);
    await manager.sync([current]);
    expect(boxes).toHaveLength(1);

    const changes: Array<Partial<SandboxEntry>> = [
      { version: '2.0.0' },
      { main: 'bootstrap.js' },
      { permissions: ['log', 'net'] },
      { contentFingerprint: 'sha256:two' },
    ];
    for (const change of changes) {
      const previous = boxes.at(-1)!;
      current = { ...current, ...change };
      await manager.sync([current]);
      expect(previous.disposed).toBe(true);
      expect(boxes).toHaveLength(changes.indexOf(change) + 2);
      expect(manager.stateOf('example')?.running).toBe(true);
    }
  });

  it('启动失败会释放失败实例并在下一次同步重试', async () => {
    const boxes: DeferredSandbox[] = [];
    const manager = lifecycle((options) => {
      const result = boxes.length === 0 ? { ok: false, error: 'worker failed' } : { ok: true };
      const box = new DeferredSandbox(options, result);
      boxes.push(box);
      return box;
    });

    await manager.sync([entry()]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].disposed).toBe(true);
    expect(manager.stateOf('example')).toEqual({ running: false, error: 'worker failed' } satisfies PluginSandboxView);

    await manager.sync([entry()]);
    expect(boxes).toHaveLength(2);
    expect(manager.stateOf('example')).toEqual({ running: true, error: undefined });
  });

  it('并发同步共享同一启动；新代次启动后迟到的旧失败不覆盖当前运行态', async () => {
    const boxes: DeferredSandbox[] = [];
    const manager = lifecycle((options) => {
      const box = new DeferredSandbox(options);
      boxes.push(box);
      return box;
    });

    const firstSync = manager.sync([entry()]);
    const duplicateSync = manager.sync([entry()]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].starts).toBe(1);
    boxes[0].finish({ ok: true });
    await Promise.all([firstSync, duplicateSync]);

    const staleSync = manager.sync([entry({ version: '2.0.0' })]);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].disposed).toBe(true);
    const currentBox = boxes[1];
    const currentSync = manager.sync([entry({ version: '2.0.0' })]);
    expect(boxes).toHaveLength(2);

    currentBox.finish({ ok: true });
    await currentSync;
    // 模拟旧 worker 的能力调用在替换后才返回。它只能结清旧代次，不能污染新实例状态。
    boxes[0].finish({ ok: false, error: 'stale capability result' });
    await staleSync;
    expect(manager.stateOf('example')).toEqual({ running: true, error: undefined });
  });

  it('停用会释放正在启动的实例并让原同步立即返回', async () => {
    const boxes: DeferredSandbox[] = [];
    const manager = lifecycle((options) => {
      const box = new DeferredSandbox(options);
      boxes.push(box);
      return box;
    });

    const startSync = manager.sync([entry()]);
    const stopSync = manager.sync([entry({ enabled: false })]);
    await Promise.all([startSync, stopSync]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].disposed).toBe(true);
    boxes[0].finish({ ok: true });
    expect(manager.stateOf('example')).toBeUndefined();
  });

  it('替换后旧 worker 的迟到能力回执只会发回旧 worker', async () => {
    let resolveOldHttp!: (response: { status: number; headers: Record<string, string>; content: string }) => void;
    let firstRequestSeen!: () => void;
    let secondRequestSeen!: () => void;
    let newReplyLogged!: () => void;
    const firstRequest = new Promise<void>((resolve) => (firstRequestSeen = resolve));
    const secondRequest = new Promise<void>((resolve) => (secondRequestSeen = resolve));
    const newLog = new Promise<void>((resolve) => (newReplyLogged = resolve));
    const oldHttp = new Promise<{ status: number; headers: Record<string, string>; content: string }>(
      (resolve) => (resolveOldHttp = resolve),
    );
    const logs: string[] = [];
    let requests = 0;
    const runtimeApi = {
      http: async () => {
        requests += 1;
        if (requests === 1) {
          firstRequestSeen();
          return oldHttp;
        }
        secondRequestSeen();
        return { status: 200, headers: {}, content: 'new-result' };
      },
      download: async () => ({ bytes: 0 }),
      kv: () => '',
      settings: () => undefined,
      fs: () => undefined,
      log: (_id: string, _level: string, message: string) => {
        logs.push(message);
        if (message === 'new-result') newReplyLogged();
      },
      notify: async () => undefined,
      clipboard: () => '',
      dialog: async () => undefined,
      player: async () => ({ ok: true }),
      openExternal: async () => undefined,
    } as unknown as PluginSandboxApi;

    const workerCode = `
      const { parentPort } = require('node:worker_threads');
      parentPort.on('message', (message) => {
        if (message && message.t === 'reply' && message.id === 77 && message.ok) {
          parentPort.postMessage({ t: 'log', level: 'i', msg: message.value.content });
        }
      });
      parentPort.postMessage({ t: 'ready' });
      parentPort.postMessage({ t: 'http', id: 77, url: 'https://example.invalid', opts: {} });
    `;
    const manager = new PluginSandboxLifecycle({
      api: runtimeApi,
      workerFile: 'unused-worker.cjs',
      logger,
      factory: (options) => new PluginSandbox({ ...options, code: workerCode }),
    });

    try {
      await manager.sync([entry({ main: 'old.js' })]);
      await firstRequest;
      await manager.sync([entry({ version: '2.0.0', main: 'new.js' })]);
      await secondRequest;
      await newLog;

      resolveOldHttp({ status: 200, headers: {}, content: 'old-result' });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(logs).toEqual(['new-result']);
      expect(manager.stateOf('example')).toEqual({ running: true, error: undefined });
    } finally {
      manager.disposeAll();
      resolveOldHttp({ status: 200, headers: {}, content: 'old-result' });
    }
  });
});
