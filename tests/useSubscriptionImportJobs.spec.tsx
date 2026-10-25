// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionImportProgressEvent } from '../src/shared/types';
import type {
  SubscriptionImportJobMemoryPort,
  SubscriptionImportJobsPort,
} from '../src/renderer/features/subscriptions/application/subscriptionImportPorts';
import { useSubscriptionImportJobs } from '../src/renderer/features/subscriptions/useSubscriptionImportJobs';

function job(revision: number, state: SubscriptionImportProgressEvent['state'] = 'running'): SubscriptionImportProgressEvent {
  return {
    jobId: 'job-1', revision, url: 'https://example.test/config.json', name: 'Example', state,
    total: 2, completed: revision, succeeded: revision, failed: 0, pending: 2 - revision,
    updatedAt: `2026-10-24T00:00:0${revision}.000Z`,
  };
}

function setup() {
  let publish: ((event: SubscriptionImportProgressEvent) => void) | undefined;
  const jobs: SubscriptionImportJobsPort = {
    onProgress: vi.fn(listener => { publish = listener; return vi.fn(); }),
    listJobs: vi.fn().mockResolvedValue([]),
    startJob: vi.fn().mockResolvedValue(job(1)),
    cancelJob: vi.fn().mockResolvedValue(job(2, 'cancelled')),
    retryFailed: vi.fn().mockResolvedValue(job(2)),
    continuePending: vi.fn().mockResolvedValue(job(2)),
    resumeInterrupted: vi.fn().mockResolvedValue(job(2)),
  };
  const memory: SubscriptionImportJobMemoryPort = {
    readJobId: vi.fn().mockReturnValue(''),
    rememberJobId: vi.fn(),
    forgetJobId: vi.fn(),
  };
  const setBusy = vi.fn();
  const setError = vi.fn();
  const setName = vi.fn();
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const rendered = renderHook(() => useSubscriptionImportJobs({
    setBusy,
    setError,
    setName,
    name: 'Local name',
    onRefresh,
    importer: jobs,
    jobMemory: memory,
  }));
  return { ...rendered, jobs, memory, setBusy, setError, setName, onRefresh, publish: (event: SubscriptionImportProgressEvent) => publish?.(event) };
}

describe('subscription import job controller', () => {
  it('persists the active job, ignores stale progress, and refreshes after a terminal event', async () => {
    const context = setup();
    await waitFor(() => expect(context.jobs.listJobs).toHaveBeenCalledOnce());

    await act(async () => {
      await context.result.current.startSubscriptionImport('https://example.test/config.json', 'Example', true);
    });
    expect(context.memory.rememberJobId).toHaveBeenCalledWith('job-1');
    expect(context.setName).toHaveBeenCalledWith('');
    expect(context.result.current.job).toEqual(job(1));

    act(() => context.publish(job(3, 'completed')));
    expect(context.result.current.job).toEqual(job(3, 'completed'));
    expect(context.onRefresh).toHaveBeenCalledOnce();

    act(() => context.publish(job(2, 'running')));
    expect(context.result.current.job).toEqual(job(3, 'completed'));
  });
});
