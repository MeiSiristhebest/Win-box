import type { SkipStore } from './skipSegments';

export interface SkipSegmentsMemoryPort {
  read(): SkipStore;
  save(store: SkipStore): void;
}

export interface SkipSegmentsMenuDismissalPort {
  subscribe(menuElement: () => object | null, dismiss: () => void): () => void;
}

export type SkipSegmentsTimerHandle = number | object;

export interface SkipSegmentsSchedulerPort {
  schedule(callback: () => void, delayMs: number): SkipSegmentsTimerHandle;
  cancel(timer: SkipSegmentsTimerHandle): void;
}

export interface SkipSegmentsClockPort {
  now(): number;
}

export interface SkipSegmentsControllerPorts {
  memory: SkipSegmentsMemoryPort;
  menuDismissal: SkipSegmentsMenuDismissalPort;
  scheduler: SkipSegmentsSchedulerPort;
  clock: SkipSegmentsClockPort;
}
