import { describe, expect, it, vi } from 'vitest';
import {
  SubscriptionImportService,
  type PersistedSubscriptionImportJob,
  type SubscriptionImportJobPersistence,
  type SubscriptionImportProgressPatch,
  type SubscriptionImportRunner,
} from '../src/main/subscriptions/SubscriptionImportService';

async function waitForTerminal(service: SubscriptionImportService, jobId: string) {
  await vi.waitFor(() => {
    const state = service.get(jobId)?.state;
    expect(['completed', 'partial', 'failed', 'cancelled', 'interrupted']).toContain(state);
  });
  return service.get(jobId)!;
}

describe('SubscriptionImportService', () => {
  class MemoryJobStore implements SubscriptionImportJobPersistence {
    jobs: PersistedSubscriptionImportJob[] = [];

    load() {
      return structuredClone(this.jobs);
    }

    save(jobs: PersistedSubscriptionImportJob[]) {
      this.jobs = structuredClone(jobs);
    }
  }

  it('publishes monotonic revisions and blocks a second active job', async () => {
    const events: Array<{ jobId: string; revision: number }> = [];
    const service = new SubscriptionImportService((event) => events.push(event));
    const job = service.start('https://example.test/list.json', 'test', async (_signal, _selection, update) => {
      update({ total: 1, completed: 1, succeeded: 1, failed: 0, pending: 0 });
    });

    expect(job.revision).toBe(0);
    expect(() => service.start('https://example.test/other.json', '', async () => {})).toThrow('已有订阅导入任务正在运行');
    const final = await waitForTerminal(service, job.jobId);
    expect(final.state).toBe('completed');
    expect(final.revision).toBeGreaterThan(job.revision);
    const revisions = events.filter((event) => event.jobId === job.jobId).map((event) => event.revision);
    expect(revisions).toEqual(revisions.toSorted((a, b) => a - b));
  });

  it('aborts the runner and reaches a cancelled terminal state', async () => {
    const service = new SubscriptionImportService();
    let release!: () => void;
    let observedSignal: AbortSignal | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const job = service.start('https://example.test/list.json', '', async (signal) => {
      observedSignal = signal;
      await gate;
    });

    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    service.cancel(job.jobId);
    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
    release();
    expect((await waitForTerminal(service, job.jobId)).state).toBe('cancelled');
  });

  it('ignores late runner progress after cancellation reaches a terminal state', async () => {
    const service = new SubscriptionImportService();
    let reportProgress: ((patch: SubscriptionImportProgressPatch) => void) | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const job = service.start('https://example.test/list.json', '', async (signal, _selection, update) => {
      reportProgress = update;
      markStarted();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    });

    await started;
    service.cancel(job.jobId);
    const cancelled = await waitForTerminal(service, job.jobId);
    reportProgress?.({ state: 'running', total: 99, completed: 99, succeeded: 99, failed: 0, pending: 0 });

    expect(cancelled.state).toBe('cancelled');
    expect(service.get(job.jobId)).toEqual(cancelled);
  });

  it('reports a multi-repo run with zero successes and no pending items as failed', async () => {
    const service = new SubscriptionImportService();
    const job = service.start('https://example.test/list.json', '', async (_signal, _selection, update) => {
      update({ total: 2, completed: 2, succeeded: 0, failed: 2, pending: 0 });
    });

    expect((await waitForTerminal(service, job.jobId)).state).toBe('failed');
  });

  it('retries only failed entries, then continues only pending entries', async () => {
    const selections: string[] = [];
    let call = 0;
    const runnerImpl: SubscriptionImportRunner = async (_signal, selection, update) => {
      selections.push(selection);
      call += 1;
      if (call === 1) update({ total: 3, completed: 2, succeeded: 1, failed: 1, pending: 1 });
      else if (call === 2) update({ total: 3, completed: 2, succeeded: 2, failed: 0, pending: 1 });
      else update({ total: 3, completed: 3, succeeded: 3, failed: 0, pending: 0 });
    };
    const runner = vi.fn(runnerImpl);
    const service = new SubscriptionImportService();
    const first = service.start('https://example.test/list.json', '', runner);
    expect((await waitForTerminal(service, first.jobId)).state).toBe('partial');

    const retry = service.retryFailed(first.jobId);
    expect((await waitForTerminal(service, retry.jobId)).state).toBe('partial');
    const continuation = service.continuePending(retry.jobId);
    expect((await waitForTerminal(service, continuation.jobId)).state).toBe('completed');
    expect(selections).toEqual(['all', 'failed', 'pending']);
  });

  it('restores a persisted active job as interrupted and resumes its saved selection', async () => {
    const store = new MemoryJobStore();
    store.save([{
      selection: 'pending',
      progress: {
        jobId: 'restored-job',
        revision: 4,
        url: 'https://example.test/list.json',
        name: 'restored',
        state: 'running',
        total: 3,
        completed: 1,
        succeeded: 1,
        failed: 0,
        pending: 2,
        updatedAt: new Date().toISOString(),
      },
    }]);
    const selections: string[] = [];
    const restored = new SubscriptionImportService(undefined, store, () => async (_signal, selection, update) => {
      selections.push(selection);
      update({ total: 2, completed: 2, succeeded: 2, failed: 0, pending: 0 });
    });

    expect(restored.get('restored-job')).toMatchObject({ state: 'interrupted', completed: 1, pending: 2 });
    expect(restored.list()).toHaveLength(1);
    const resumed = restored.resumeInterrupted('restored-job');
    expect((await waitForTerminal(restored, resumed.jobId)).state).toBe('completed');
    expect(selections).toEqual(['pending']);
  });

  it('persists the parsed manifest and passes it to a runner after restart', async () => {
    const store = new MemoryJobStore();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const initial = new SubscriptionImportService(undefined, store);
    const job = initial.start('https://example.test/list.json', 'example', async (signal, _selection, _update, _checkpoint, saveCheckpoint) => {
      saveCheckpoint({ multiRepoItems: [
        { url: 'https://example.test/one.json', name: 'one' },
        { url: 'https://example.test/two.json' },
      ] });
      markStarted();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    });

    await started;
    expect(store.jobs[0]?.runnerCheckpoint).toEqual({ multiRepoItems: [
      { url: 'https://example.test/one.json', name: 'one' },
      { url: 'https://example.test/two.json' },
    ] });
    initial.dispose();

    let restoredCheckpoint: unknown;
    const restored = new SubscriptionImportService(undefined, store, () => async (_signal, _selection, _update, checkpoint) => {
      restoredCheckpoint = checkpoint;
    });
    expect(restored.get(job.jobId)?.state).toBe('interrupted');
    const resumed = restored.resumeInterrupted(job.jobId);

    expect((await waitForTerminal(restored, resumed.jobId)).state).toBe('completed');
    expect(restoredCheckpoint).toEqual({ multiRepoItems: [
      { url: 'https://example.test/one.json', name: 'one' },
      { url: 'https://example.test/two.json' },
    ] });
  });

  it('saves an interrupted state before aborting active work on shutdown', async () => {
    const store = new MemoryJobStore();
    const service = new SubscriptionImportService(undefined, store);
    const job = service.start('https://example.test/list.json', '', (signal) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    await vi.waitFor(() => expect(service.get(job.jobId)?.state).toBe('running'));

    service.dispose();

    expect(service.get(job.jobId)?.state).toBe('interrupted');
    expect(store.jobs[0]?.progress.state).toBe('interrupted');
  });
});
