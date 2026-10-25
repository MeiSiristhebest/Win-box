import type { AggregateSearchSessionClock } from '../application/aggregateSearchSession';

/** Browser timer adapter for the React-free aggregate search session. */
export const rendererSearchClock: AggregateSearchSessionClock = {
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (timer) => window.clearTimeout(timer as number),
};

/** Wall-clock adapter for measuring one-source request duration. */
export const rendererSearchWallClock = { now: (): number => Date.now() };

/** Browser animation-frame adapter for the renderer-free home-search workflow. */
export const rendererSearchFrames = {
  request: (callback: () => void): number => window.requestAnimationFrame(callback),
  cancel: (handle: number): void => window.cancelAnimationFrame(handle),
};
