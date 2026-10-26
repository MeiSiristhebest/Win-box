import { describe, expect, it, vi } from 'vitest';
import type { SearchAllReport } from '../src/shared/types';
import { AggregateSearchRequestBroker } from '../src/main/spider/AggregateSearchRequestBroker';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function report(): SearchAllReport {
  return { items: [], perSource: [], hitSources: 0, failedSources: 0, totalRaw: 0 };
}

describe('AggregateSearchRequestBroker cancellation', () => {
  it('keeps shared work alive until the final subscriber cancels', async () => {
    const request = deferred<SearchAllReport>();
    let backendSignal!: AbortSignal;
    const execute = vi.fn((_publish, signal: AbortSignal) => {
      backendSignal = signal;
      return request.promise;
    });
    const broker = new AggregateSearchRequestBroker();
    const first = new AbortController();
    const second = new AbortController();
    const firstWaiter = broker.run('same search', execute, undefined, first.signal);
    const secondWaiter = broker.run('same search', execute, undefined, second.signal);

    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    first.abort();
    await expect(firstWaiter).rejects.toMatchObject({ name: 'AbortError' });
    expect(backendSignal.aborted).toBe(false);

    request.resolve(report());
    await expect(secondWaiter).resolves.toEqual(report());
    expect(execute).toHaveBeenCalledOnce();
  });

  it('aborts backend work when the last subscriber cancels and keeps new work bounded', async () => {
    const firstExecution = deferred<SearchAllReport>();
    const nextExecution = deferred<SearchAllReport>();
    const firstController = new AbortController();
    let firstBackendSignal!: AbortSignal;
    let executionCount = 0;
    const broker = new AggregateSearchRequestBroker(1, 1);
    const firstWaiter = broker.run('first', (_publish, signal) => {
      firstBackendSignal = signal;
      executionCount++;
      return firstExecution.promise;
    }, undefined, firstController.signal);
    const queuedController = new AbortController();
    const queuedWaiter = broker.run('queued', (_publish, signal) => {
      expect(signal.aborted).toBe(false);
      executionCount++;
      return nextExecution.promise;
    }, undefined, queuedController.signal);
    const overflow = broker.run('overflow', async () => report()).then(() => null, (error: unknown) => error);

    await vi.waitFor(() => expect(executionCount).toBe(1));
    const overflowError = await overflow;
    expect(overflowError).toBeInstanceOf(Error);
    expect((overflowError as Error).message).toContain('队列已满');
    firstController.abort();
    await expect(firstWaiter).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstBackendSignal.aborted).toBe(true);
    expect(executionCount).toBe(1);

    firstExecution.resolve(report());
    await vi.waitFor(() => expect(executionCount).toBe(2));
    nextExecution.resolve(report());
    await expect(queuedWaiter).resolves.toEqual(report());
  });

  it('removes a queued request when its only waiter cancels', async () => {
    const running = deferred<SearchAllReport>();
    const queued = new AbortController();
    const broker = new AggregateSearchRequestBroker(1, 2);
    const first = broker.run('running', () => running.promise);
    const secondExecute = vi.fn(async () => report());
    const second = broker.run('queued', secondExecute, undefined, queued.signal);

    await vi.waitFor(() => expect(secondExecute).not.toHaveBeenCalled());
    queued.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    running.resolve(report());
    await expect(first).resolves.toEqual(report());
    expect(secondExecute).not.toHaveBeenCalled();
  });
});
