import { describe, expect, it, vi } from 'vitest';
import { createHomeBrowseRequestSession, type HomeBrowseTimerPort } from '../src/renderer/features/home/application/homeBrowseRequestSession';

function createTimer() {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const timer: HomeBrowseTimerPort = {
    schedule: vi.fn((callback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    }),
    cancel: vi.fn((handle) => { cancelled.push(handle as number); }),
  };
  return { timer, callbacks, cancelled };
}

describe('HomeBrowseRequestSession', () => {
  it('invalidates older home and category requests while metadata has its own generation', () => {
    const session = createHomeBrowseRequestSession();
    const home = session.beginHomeRequest(false);
    const metadata = session.beginMetadataRequest();
    const category = session.beginCategoryRequest();

    expect(session.isListRequestCurrent(home)).toBe(false);
    expect(home.signal.aborted).toBe(true);
    expect(session.isListRequestCurrent(category)).toBe(true);
    expect(session.isMetadataRequestCurrent(metadata)).toBe(true);
    expect(metadata.signal.aborted).toBe(false);

    session.invalidateBrowseRequests();
    expect(category.signal.aborted).toBe(true);
    expect(metadata.signal.aborted).toBe(true);
    expect(session.isListRequestCurrent(category)).toBe(false);
    expect(session.isMetadataRequestCurrent(metadata)).toBe(false);
  });

  it('cancels a delayed source-preparation retry when a category request supersedes it', () => {
    const { timer, callbacks, cancelled } = createTimer();
    const session = createHomeBrowseRequestSession(timer);
    const generation = session.beginHomeRequest(false);
    const retry = vi.fn();
    const isCurrent = () => session.isListRequestCurrent(generation);

    expect(session.schedulePreparationRetry({ isCurrent, retry })).toBe(true);
    expect(timer.schedule).toHaveBeenCalledWith(expect.any(Function), 20_000);
    const scheduledCallback = callbacks.get(1)!;

    session.beginCategoryRequest();
    scheduledCallback();

    expect(cancelled).toEqual([1]);
    expect(retry).not.toHaveBeenCalled();
  });

  it('bounds source-preparation retries and resets the budget after success or a fresh home request', () => {
    const { timer, callbacks } = createTimer();
    const session = createHomeBrowseRequestSession(timer);
    let generation = session.beginHomeRequest(false);
    const retry = vi.fn(() => { generation = session.beginHomeRequest(true); });
    const scheduleRetry = () => session.schedulePreparationRetry({
      isCurrent: () => session.isListRequestCurrent(generation),
      retry,
    });

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      expect(scheduleRetry()).toBe(true);
      callbacks.get(attempt)!();
    }
    expect(scheduleRetry()).toBe(false);
    expect(retry).toHaveBeenCalledTimes(12);

    session.resetPreparationRetryBudget();
    generation = session.beginHomeRequest(false);
    expect(scheduleRetry()).toBe(true);
  });

  it('invalidates pending work on dispose and can reactivate for React strict-effect replay', () => {
    const { timer, callbacks, cancelled } = createTimer();
    const session = createHomeBrowseRequestSession(timer);
    const first = session.beginHomeRequest(false);
    const retry = vi.fn();
    session.schedulePreparationRetry({ isCurrent: () => session.isListRequestCurrent(first), retry });
    const callback = callbacks.get(1)!;

    session.dispose();
    callback();
    expect(cancelled).toEqual([1]);
    expect(session.isListRequestCurrent(first)).toBe(false);
    expect(retry).not.toHaveBeenCalled();

    session.activate();
    const second = session.beginHomeRequest(false);
    expect(session.isListRequestCurrent(second)).toBe(true);
  });
});
