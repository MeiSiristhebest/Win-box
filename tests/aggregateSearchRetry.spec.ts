import { describe, expect, it, vi } from 'vitest';
import { AggregateSearchRetrySchedule } from '../src/renderer/features/home/application/aggregateSearchRetry';

function createClock() {
  let nextId = 0;
  const pending = new Map<number, () => void>();
  return {
    pending,
    schedule: vi.fn((callback: () => void, _delayMs: number) => {
      const id = ++nextId;
      pending.set(id, callback);
      return id;
    }),
    cancel: vi.fn((handle: unknown) => { pending.delete(handle as number); }),
    runNext() {
      const entry = pending.entries().next().value as [number, () => void] | undefined;
      if (!entry) return;
      pending.delete(entry[0]);
      entry[1]();
    },
  };
}

describe('AggregateSearchRetrySchedule', () => {
  it('runs a retry only after its configured delay and while its search is current', () => {
    const clock = createClock();
    const schedule = new AggregateSearchRetrySchedule(clock, { delayMs: 30_000, maxAttempts: 12 });
    const isCurrent = vi.fn(() => true);
    const retry = vi.fn();

    expect(schedule.schedule(isCurrent, retry)).toBe(true);
    expect(clock.schedule).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(retry).not.toHaveBeenCalled();

    clock.runNext();

    expect(isCurrent).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('drops a scheduled retry after the search becomes stale', () => {
    const clock = createClock();
    const schedule = new AggregateSearchRetrySchedule(clock);
    const retry = vi.fn();

    schedule.schedule(() => false, retry);
    clock.runNext();

    expect(retry).not.toHaveBeenCalled();
  });

  it('cancels a pending retry and resets the attempt budget', () => {
    const clock = createClock();
    const schedule = new AggregateSearchRetrySchedule(clock, { delayMs: 30_000, maxAttempts: 1 });

    expect(schedule.schedule(() => true, vi.fn())).toBe(true);
    schedule.reset();
    expect(clock.pending.size).toBe(0);
    expect(clock.cancel).toHaveBeenCalledOnce();
    expect(schedule.schedule(() => true, vi.fn())).toBe(true);
  });

  it('stops scheduling after the configured number of retries', () => {
    const clock = createClock();
    const schedule = new AggregateSearchRetrySchedule(clock, { delayMs: 1, maxAttempts: 2 });

    expect(schedule.schedule(() => true, vi.fn())).toBe(true);
    clock.runNext();
    expect(schedule.schedule(() => true, vi.fn())).toBe(true);
    clock.runNext();
    expect(schedule.schedule(() => true, vi.fn())).toBe(false);
    expect(clock.schedule).toHaveBeenCalledTimes(2);
  });
});
