import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineHost } from '../src/engine/ports';
import type { Spider } from '../src/engine/spider/Spider';
import type { SourceSearchHealth } from '../src/engine/vod/SourceSearchHealth';
import type { Logger, SourceBean } from '../src/shared/types';
import {
  SpiderRuntimeLifecycle,
  type SpiderBridgeLifecyclePort,
  type SpiderFactoryLifecyclePort,
  type SpiderRuntimeLifecyclePorts,
} from '../src/main/spider/SpiderRuntimeLifecycle';

interface ScheduledCall {
  callback: () => void;
  delayMs: number;
  unref: ReturnType<typeof vi.fn>;
}

function source(key: string, api = 'https://source.test/api'): SourceBean {
  return { key, api } as SourceBean;
}

function setup(overrides: Partial<SpiderRuntimeLifecyclePorts> = {}) {
  const timers: ScheduledCall[] = [];
  const bridge: SpiderBridgeLifecyclePort = {
    setDefaultJar: vi.fn(),
    warmup: vi.fn(async () => undefined),
    resetPool: vi.fn(),
    alivePoolCount: vi.fn(() => 2),
    armPoolShrink: vi.fn(),
    dispose: vi.fn(),
  };
  const spiders: SpiderFactoryLifecyclePort = {
    createForSource: vi.fn(() => ({}) as Spider),
    clear: vi.fn(),
  };
  const logger: Pick<Logger, 'i'> = { i: vi.fn() };
  const ports: SpiderRuntimeLifecyclePorts = {
    bridge,
    spiders,
    host: {} as EngineHost,
    searchableSources: () => [],
    sourceHealth: { scheduleOrder: (sources) => sources.map((_, index) => index) } as Pick<SourceSearchHealth, 'scheduleOrder'>,
    logger,
    now: () => 100_000,
    schedule: (callback, delayMs) => {
      const timer = { callback, delayMs, unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
      timers.push(timer as unknown as ScheduledCall);
      return timer;
    },
    cancel: vi.fn(),
    ...overrides,
  };
  const lifecycle = new SpiderRuntimeLifecycle(ports);
  return { lifecycle, ports, bridge, spiders, logger, timers };
}

describe('SpiderRuntimeLifecycle', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('warms only the latest default jar after startup preparation is enabled', () => {
    const { lifecycle, bridge } = setup();
    lifecycle.setDefaultJar('jar-a');
    lifecycle.setDefaultJar('jar-b');

    expect(bridge.warmup).not.toHaveBeenCalled();
    lifecycle.enablePrewarm();

    expect(bridge.warmup).toHaveBeenCalledOnce();
    expect(bridge.warmup).toHaveBeenCalledWith('jar-b');
  });

  it('clears a deferred jar when configuration removes the default spider', () => {
    const { lifecycle, bridge } = setup();
    lifecycle.setDefaultJar('jar-a');
    lifecycle.setDefaultJar('');
    lifecycle.enablePrewarm();

    expect(bridge.setDefaultJar).toHaveBeenNthCalledWith(1, 'jar-a');
    expect(bridge.setDefaultJar).toHaveBeenNthCalledWith(2, '');
    expect(bridge.warmup).not.toHaveBeenCalled();
  });

  it('coalesces config prewarm timers and waits for the startup gate', () => {
    const prewarm = vi.fn(() => 1);
    const warmup = vi.fn();
    const spider = { prewarm, warmup } as unknown as Spider;
    const sources = [source('jar-source'), source('python-source', 'https://source.test/site.py')];
    const createForSource = vi.fn(() => spider);
    const { lifecycle, ports, timers } = setup({
      searchableSources: () => sources,
      spiders: { createForSource, clear: vi.fn() },
    });

    lifecycle.schedulePrewarmAfterConfigChange();
    lifecycle.schedulePrewarmAfterConfigChange();
    expect(timers).toHaveLength(2);
    expect(ports.cancel).toHaveBeenCalledWith(timers[0]);

    timers[1].callback();
    expect(createForSource).not.toHaveBeenCalled();

    lifecycle.enablePrewarm();
    expect(createForSource).toHaveBeenCalledTimes(3);
    expect(prewarm).toHaveBeenCalledTimes(2);
    expect(warmup).toHaveBeenCalledOnce();
  });

  it('uses recent source order and throttles repeated JVM pool prewarm', () => {
    const prewarm = vi.fn(() => 1);
    const spider = { prewarm } as unknown as Spider;
    const sources = [source('first'), source('second')];
    const health = { scheduleOrder: vi.fn(() => [1, 0]) };
    const createForSource = vi.fn(() => spider);
    const { lifecycle, ports } = setup({
      searchableSources: () => sources,
      sourceHealth: health,
      spiders: { createForSource, clear: vi.fn() },
    });

    expect(lifecycle.prewarmSpiders(1, 2)).toBe(1);
    expect(lifecycle.prewarmSpiders(1, 2)).toBe(0);
    expect(health.scheduleOrder).toHaveBeenCalledWith(sources);
    expect(createForSource).toHaveBeenCalledOnce();
    expect(prewarm).toHaveBeenCalledWith(2);
    expect(ports.logger.i).toHaveBeenCalledOnce();
  });

  it('rewarms the last jar and both runtime families after cache cleanup', () => {
    const prewarm = vi.fn(() => 1);
    const warmup = vi.fn();
    const spider = { prewarm, warmup } as unknown as Spider;
    const sources = [source('jvm'), source('python', 'https://source.test/site.py')];
    const createForSource = vi.fn(() => spider);
    const { lifecycle, bridge, timers } = setup({
      searchableSources: () => sources,
      spiders: { createForSource, clear: vi.fn() },
    });
    lifecycle.enablePrewarm();
    lifecycle.setDefaultJar('jar-cache');

    lifecycle.rewarmAfterCacheClear();
    expect(bridge.warmup).toHaveBeenCalledWith('jar-cache');
    expect(timers.at(-1)?.delayMs).toBe(500);

    timers.at(-1)?.callback();
    expect(createForSource).toHaveBeenCalledTimes(3);
    expect(prewarm).toHaveBeenCalledTimes(2);
    expect(warmup).toHaveBeenCalledOnce();
  });

  it('resets the correct layers for proxy and credential changes and disposes timers', () => {
    const { lifecycle, bridge, spiders, timers, ports } = setup();
    lifecycle.schedulePrewarmAfterConfigChange();
    lifecycle.clearSpiderInstances();
    lifecycle.resetAfterDriveCredentialChange();
    expect(spiders.clear).toHaveBeenCalledTimes(2);
    expect(bridge.resetPool).toHaveBeenCalledOnce();

    lifecycle.dispose();
    expect(ports.cancel).toHaveBeenCalledWith(timers[0]);
    expect(bridge.dispose).toHaveBeenCalledOnce();
  });

  it('cancels cache-clear warmup when the lifecycle is disposed', () => {
    const { lifecycle, timers, ports } = setup();
    lifecycle.rewarmAfterCacheClear();

    lifecycle.dispose();

    expect(ports.cancel).toHaveBeenCalledWith(timers[0]);
    timers[0].callback();
    expect(ports.spiders.createForSource).not.toHaveBeenCalled();
  });
});
