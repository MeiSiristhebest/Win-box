import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { JsWorkerPool } from '../src/engine/js/worker/JsWorkerPool';
import type { EngineHost } from '../src/engine/ports';
import type { Spider } from '../src/engine/spider/Spider';
import type { SourceSearchHealth } from '../src/engine/vod/SourceSearchHealth';
import type { Logger } from '../src/shared/types';
import {
  SpiderRuntimeLifecycle,
  type SpiderBridgeLifecyclePort,
  type SpiderFactoryLifecyclePort,
  type SpiderRuntimeLifecyclePorts,
} from '../src/main/spider/SpiderRuntimeLifecycle';

let pool: JsWorkerPool | undefined;
afterEach(() => {
  pool?.dispose();
  pool = undefined;
});

function createPool() {
  const firstCallStarted = Promise.withResolvers<void>();
  const startedWorkers: string[] = [];
  pool = new JsWorkerPool({
    http: { request: async () => { throw new Error('Unexpected network'); } },
    kv: { get: () => '', set: () => undefined, delete: () => undefined },
    logger: {
      i: (message) => {
        if (message === 'worker-pool-call-started') firstCallStarted.resolve();
        if (message.includes('已启动 worker')) startedWorkers.push(message);
      },
      w: vi.fn(),
      e: vi.fn(),
    },
  }, resolve('tests/fixtures/jsWorkerPoolLifecycleProbe.cjs'));
  return { pool, firstCallStarted, startedWorkers };
}

async function settleBefore<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Promise did not settle within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('JsWorkerPool lifecycle', () => {
  it('rejects the active and every queued call when a worker crashes', async () => {
    const probe = createPool();
    const calls = ['crash', 'queued-1', 'queued-2'].map((operation) =>
      probe.pool.call('source', ['test'], [operation], 10_000),
    );

    await probe.firstCallStarted.promise;
    const results = await settleBefore(Promise.allSettled(calls));

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
  });

  it('rejects active and queued calls promptly when the pool is disposed', async () => {
    const probe = createPool();
    const calls = ['hang', 'queued-1', 'queued-2'].map((operation) =>
      probe.pool.call('source', ['test'], [operation], 10_000),
    );
    await probe.firstCallStarted.promise;

    probe.pool.dispose();
    const results = await settleBefore(Promise.allSettled(calls));

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
  });

  it('does not create workers when destroying an unopened sandbox', () => {
    const probe = createPool();

    probe.pool.createSandbox({ siteKey: 'unused', api: 'https://unused.test/spider.js', ext: '' }).destroy();

    expect(probe.startedWorkers).toHaveLength(0);
  });

  it('disposes the JS worker factory at the application lifecycle boundary', () => {
    const factory = Object.assign(vi.fn(), { dispose: vi.fn() });
    const bridge: SpiderBridgeLifecyclePort = {
      setDefaultJar: vi.fn(), warmup: vi.fn(async () => undefined), resetPool: vi.fn(),
      alivePoolCount: vi.fn(() => 0), armPoolShrink: vi.fn(), dispose: vi.fn(),
    };
    const spiders: SpiderFactoryLifecyclePort = { createForSource: vi.fn(() => ({}) as Spider), clear: vi.fn() };
    const logger: Pick<Logger, 'i'> = { i: vi.fn() };
    const ports: SpiderRuntimeLifecyclePorts = {
      bridge,
      spiders,
      host: { jsSandboxFactory: factory } as unknown as EngineHost,
      searchableSources: () => [],
      sourceHealth: { scheduleOrder: (sources) => sources.map((_, index) => index) } as Pick<SourceSearchHealth, 'scheduleOrder'>,
      logger,
    };

    new SpiderRuntimeLifecycle(ports).dispose();

    expect(spiders.clear).toHaveBeenCalledOnce();
    expect(factory.dispose).toHaveBeenCalledOnce();
    expect(bridge.dispose).toHaveBeenCalledOnce();
  });
});
