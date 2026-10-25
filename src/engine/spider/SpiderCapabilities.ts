import type { Spider } from './Spider';

export type SpiderRuntimeState = 'ready' | 'preparing' | 'unavailable';

/** Optional runtime preparation operations are modeled as small capabilities, not base-class stubs. */
export interface RuntimePreparationCapability {
  runtimeState(): SpiderRuntimeState;
  pendingRuntime?(): Promise<unknown> | null;
}

export interface SpiderWarmupCapability {
  warmup(): void;
}

export interface SpiderPrewarmCapability {
  prewarm(count?: number): number;
}

function capability<T extends object>(spider: Spider, isSupported: (value: Record<string, unknown>) => boolean): T | null {
  const value = spider as unknown as Record<string, unknown>;
  return isSupported(value) ? value as T : null;
}

export function runtimePreparationOf(spider: Spider): RuntimePreparationCapability | null {
  return capability<RuntimePreparationCapability>(spider, (value) => typeof value.runtimeState === 'function');
}

export function warmupOf(spider: Spider): SpiderWarmupCapability | null {
  return capability<SpiderWarmupCapability>(spider, (value) => typeof value.warmup === 'function');
}

export function prewarmOf(spider: Spider): SpiderPrewarmCapability | null {
  return capability<SpiderPrewarmCapability>(spider, (value) => typeof value.prewarm === 'function');
}
