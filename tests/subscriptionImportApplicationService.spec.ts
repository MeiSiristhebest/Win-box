import { describe, expect, it, vi } from 'vitest';
import type { ParseResult } from '../src/engine/config/ApiConfigParser';
import type { SubscriptionImportProgressEvent } from '../src/shared/types';
import type {
  SubscriptionConfigurationImportPort,
  SubscriptionImportJobsPort,
  SubscriptionRefreshPort,
} from '../src/main/subscriptions/SubscriptionImportApplicationPorts';
import type { SubscriptionImportRunner } from '../src/main/subscriptions/SubscriptionImportJobContracts';
import { SubscriptionImportApplicationService } from '../src/main/subscriptions/SubscriptionImportApplicationService';

function createApplication() {
  const event: SubscriptionImportProgressEvent = {
    jobId: 'job-1', revision: 0, url: 'https://example.test/repo.json', name: '', state: 'running',
    total: 0, completed: 0, succeeded: 0, failed: 0, pending: 0, updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const runner: SubscriptionImportRunner = vi.fn(async () => undefined);
  const config = { sites: [] } as unknown as ParseResult;
  const jobs: SubscriptionImportJobsPort = {
    start: vi.fn(() => event),
    cancel: vi.fn(() => event),
    retryFailed: vi.fn(() => event),
    continuePending: vi.fn(() => event),
    get: vi.fn(() => event),
    list: vi.fn(() => [event]),
    resumeInterrupted: vi.fn(() => event),
    dispose: vi.fn(),
  };
  const coordinator: SubscriptionConfigurationImportPort = {
    createRunner: vi.fn(() => runner),
    importConfig: vi.fn(async () => config),
    latestReport: null,
  };
  const autoRefresh: SubscriptionRefreshPort = {
    refreshIfDue: vi.fn(async () => true),
  };
  return {
    app: new SubscriptionImportApplicationService(jobs, coordinator, autoRefresh),
    jobs,
    coordinator,
    autoRefresh,
    event,
    runner,
    config,
  };
}

describe('SubscriptionImportApplicationService', () => {
  it('rejects non-HTTP subscription addresses before creating a runner or job', () => {
    const { app, jobs, coordinator } = createApplication();

    expect(() => app.start('file:///subscriptions.json')).toThrow('订阅地址必须使用 HTTP 或 HTTPS');
    expect(coordinator.createRunner).not.toHaveBeenCalled();
    expect(jobs.start).not.toHaveBeenCalled();
  });

  it('starts a job with the selected repository line and name', () => {
    const { app, jobs, coordinator, event, runner } = createApplication();

    expect(app.start('https://example.test/repo.json#line=2', 'fixture')).toBe(event);
    expect(coordinator.createRunner).toHaveBeenCalledWith('https://example.test/repo.json#line=2', 'fixture');
    expect(jobs.start).toHaveBeenCalledWith('https://example.test/repo.json#line=2', 'fixture', runner);
  });

  it('imports configuration with snapshotting enabled by default and exposes opt-out', async () => {
    const { app, coordinator, config } = createApplication();

    await expect(app.importConfig({ json: '{"sites":[]}' })).resolves.toBe(config);
    expect(coordinator.importConfig).toHaveBeenLastCalledWith({ json: '{"sites":[]}' }, { snapshot: true, signal: undefined });

    const controller = new AbortController();
    await app.importConfig({ url: 'https://example.test/repo.json' }, { snapshot: false, signal: controller.signal });
    expect(coordinator.importConfig).toHaveBeenLastCalledWith(
      { url: 'https://example.test/repo.json' },
      { snapshot: false, signal: controller.signal },
    );
  });

  it('delegates automatic refresh policy and import job disposal', async () => {
    const { app, jobs, autoRefresh } = createApplication();

    await expect(app.refreshIfDue()).resolves.toBe(true);
    app.dispose();
    expect(autoRefresh.refreshIfDue).toHaveBeenCalledOnce();
    expect(jobs.dispose).toHaveBeenCalledOnce();
  });
});
