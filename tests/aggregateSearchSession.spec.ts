import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchAllProgressEvent, SearchAllReport, VodItem } from '../src/shared/types';
import {
  executeAggregateSearchSession,
  type AggregateSearchSessionPorts,
} from '../src/renderer/features/home/application/aggregateSearchSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function report(): SearchAllReport {
  return { items: [], perSource: [], hitSources: 0, failedSources: 0, totalRaw: 0 };
}

function event(overrides: Partial<SearchAllProgressEvent> = {}): SearchAllProgressEvent {
  return { wd: 'show', done: 1, total: 3, ...overrides };
}

function source(key: string, profileId: string): NonNullable<SearchAllProgressEvent['source']> {
  return {
    key,
    name: key,
    profileId,
    status: 'ok',
    items: [{ id: key, name: key } as VodItem],
  };
}

function createPorts(searchAll: AggregateSearchSessionPorts['api']['searchAll'], listenerError = false) {
  let progressListener: ((progress: SearchAllProgressEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  const schedule = vi.fn((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel = vi.fn((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const publishPartialReport = vi.fn<(value: SearchAllReport) => void>();
  const publishProgress = vi.fn();
  const ports: AggregateSearchSessionPorts = {
    api: {
      onSearchAllProgress: vi.fn((listener) => {
        if (listenerError) throw new Error('progress unavailable');
        progressListener = listener;
        return unsubscribe;
      }),
      searchAll,
    },
    clock: { schedule, cancel },
    publishPartialReport,
    publishProgress,
  };
  return {
    ports,
    emit: (progress: SearchAllProgressEvent) => progressListener?.(progress),
    unsubscribe,
    schedule,
    cancel,
    publishPartialReport,
    publishProgress,
  };
}

afterEach(() => vi.useRealTimers());

describe('executeAggregateSearchSession', () => {
  it('batches streamed sources and preserves configured profile/source order', async () => {
    vi.useFakeTimers();
    const request = deferred<SearchAllReport>();
    const searchAll = vi.fn(() => request.promise);
    const harness = createPorts(searchAll);
    const isCurrent = vi.fn(() => true);

    const execution = executeAggregateSearchSession({
      term: 'show',
      refresh: true,
      scope: { kind: 'profiles', profileIds: ['profile-a', 'profile-b'] },
      isCurrent,
    }, harness.ports);

    expect(searchAll).toHaveBeenCalledWith('show', { refresh: true, profileIds: ['profile-a', 'profile-b'] });
    harness.emit(event({
      profileId: 'profile-b',
      profileOrder: 1,
      sourceOrder: 0,
      source: source('source-b', 'profile-b'),
    }));
    harness.emit(event({
      profileId: 'outside-scope',
      source: source('ignored', 'outside-scope'),
    }));
    harness.emit(event({
      profileId: 'profile-a',
      profileOrder: 0,
      sourceOrder: 2,
      done: 2,
      pending: 1,
      source: source('source-a', 'profile-a'),
    }));

    expect(harness.publishPartialReport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(199);
    expect(harness.publishPartialReport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.publishPartialReport).toHaveBeenCalledOnce();
    expect(harness.publishPartialReport.mock.calls[0][0].perSource.map((item) => item.key)).toEqual(['source-a', 'source-b']);
    expect(harness.publishProgress).toHaveBeenCalledWith({ done: 2, total: 3, pending: 1 });

    request.resolve(report());
    await expect(execution).resolves.toEqual({ kind: 'completed', report: report() });
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.publishProgress).toHaveBeenLastCalledWith(null);
  });

  it('uses the current profile scope and continues when progress subscription is unavailable', async () => {
    const finalReport = report();
    const searchAll = vi.fn(async () => finalReport);
    const harness = createPorts(searchAll, true);

    await expect(executeAggregateSearchSession({
      term: 'show',
      refresh: false,
      scope: { kind: 'profile', profileId: 'profile-a' },
      isCurrent: () => true,
    }, harness.ports)).resolves.toEqual({ kind: 'completed', report: finalReport });

    expect(searchAll).toHaveBeenCalledWith('show', { refresh: false, profileId: 'profile-a' });
    expect(harness.publishPartialReport).not.toHaveBeenCalled();
  });

  it('returns an explicit failure and always unsubscribes', async () => {
    const searchAll = vi.fn(async () => { throw new Error('offline'); });
    const harness = createPorts(searchAll);

    await expect(executeAggregateSearchSession({
      term: 'show',
      refresh: false,
      scope: { kind: 'profile', profileId: 'profile-a' },
      isCurrent: () => true,
    }, harness.ports)).resolves.toEqual({ kind: 'failed', message: 'offline' });

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.publishProgress).toHaveBeenLastCalledWith(null);
  });

  it('drops stale responses and does not publish stale progress or reset newer state', async () => {
    const request = deferred<SearchAllReport>();
    const harness = createPorts(vi.fn(() => request.promise));
    let current = true;
    const execution = executeAggregateSearchSession({
      term: 'show',
      refresh: false,
      scope: { kind: 'profile', profileId: 'profile-a' },
      isCurrent: () => current,
    }, harness.ports);

    current = false;
    request.resolve(report());
    await expect(execution).resolves.toEqual({ kind: 'stale' });
    expect(harness.publishPartialReport).not.toHaveBeenCalled();
    expect(harness.publishProgress).not.toHaveBeenCalled();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });
});
