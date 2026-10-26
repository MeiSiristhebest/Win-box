import { describe, expect, it, vi } from 'vitest';
import type { SourceBean, VodItem } from '../src/shared/types';
import { FairProfileWorkerBudget, raceTimeout } from '../src/engine/vod/searchRuntime';
import {
  AggregateSearchCoordinator,
  type AggregateSearchDependencies,
} from '../src/main/spider/AggregateSearchCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeSource(): SourceBean {
  return {
    key: 'source-a',
    name: 'Source A',
    type: 0,
    api: 'https://example.test/api',
    searchable: 1,
    quickSearch: 1,
    changeable: 1,
    filterable: 1,
    playUrl: '',
    ext: '',
    jar: '',
    playerType: -1,
    categories: null,
    timeout: 10,
    click: '',
    style: '',
  };
}

function makeCoordinator(search: AggregateSearchDependencies['sources']['search']) {
  const source = makeSource();
  const dependencies: AggregateSearchDependencies = {
    profiles: {
      list: () => [{ id: 'ProfileA', name: 'Profile A' }],
      executionContext: (profileId = 'ProfileA') => ({ profileId, config: null }),
      revision: () => 0,
      activeProfileId: () => 'ProfileA',
      activeSourceKey: () => source.key,
    },
    sources: {
      searchable: () => [source],
      search,
    },
    readiness: {
      prepare: async ({ sources }) => ({
        active: sources.map((_source, index) => index),
        skipped: sources.map(() => null),
      }),
    },
    createWorkerBudget: (limit, profileIds, initiallyActive) =>
      new FairProfileWorkerBudget(limit, profileIds, initiallyActive),
    health: {
      scheduleOrder: (sources) => sources.map((_source, index) => index),
      sourceBudget: (_source, maximumMs) => maximumMs,
      succeeded: () => undefined,
      failed: () => undefined,
    },
    timing: {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle),
      withTimeout: raceTimeout,
    },
    logger: { i: () => undefined, w: () => undefined },
  };
  return new AggregateSearchCoordinator(dependencies);
}

describe('AggregateSearchCoordinator lifecycle', () => {
  it('passes caller cancellation to the active source request and rejects the waiter promptly', async () => {
    let sourceSignal: AbortSignal | undefined;
    const search = vi.fn<AggregateSearchDependencies['sources']['search']>((_source, _term, _budget, signal) => {
      sourceSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const coordinator = makeCoordinator(search);
    const controller = new AbortController();
    const request = coordinator.run('Movie', { profileId: 'ProfileA' }, undefined, controller.signal);

    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(sourceSignal?.aborted).toBe(true);
  });

  it('does not let a pre-invalidation search overwrite the fresh cache entry', async () => {
    const pending = [deferred<VodItem[]>(), deferred<VodItem[]>(), deferred<VodItem[]>()];
    let requestIndex = 0;
    const search = vi.fn<AggregateSearchDependencies['sources']['search']>(() => {
      const request = pending[requestIndex++];
      if (!request) throw new Error('unexpected search request');
      return request.promise;
    });
    const coordinator = makeCoordinator(search);

    const staleSearch = coordinator.run(' Movie ', { profileId: 'ProfileA' });
    const staleResult = staleSearch.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));

    coordinator.invalidateConfiguration();
    const freshSearch = coordinator.run('Movie', { profileId: 'ProfileA' });
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));

    pending[1]!.resolve([]);
    await freshSearch;
    pending[0]!.reject(Object.assign(new Error('unsupported runtime'), { code: 'JS_BYTECODE' }));
    await expect(staleResult).resolves.toMatchObject({ ok: false, error: { name: 'AbortError' } });

    const cachedSearch = await coordinator.run('Movie', { profileId: 'ProfileA' });
    expect(search).toHaveBeenCalledTimes(2);
    expect(cachedSearch.cachedAt).toEqual(expect.any(Number));

    const laterSearch = coordinator.run('Different movie', { profileId: 'ProfileA' });
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    pending[2]!.resolve([]);
    await laterSearch;
  });

  it('invalidates cached reports when shared drive credentials change', async () => {
    const search = vi.fn<AggregateSearchDependencies['sources']['search']>().mockResolvedValue([]);
    const coordinator = makeCoordinator(search);

    await coordinator.run('Movie', { profileId: 'ProfileA' });
    coordinator.invalidateCredentials();
    await coordinator.run('Movie', { profileId: 'ProfileA' });

    expect(search).toHaveBeenCalledTimes(2);
  });
});
