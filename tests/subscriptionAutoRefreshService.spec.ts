import { describe, expect, it, vi } from 'vitest';
import { SubscriptionAutoRefreshService, type SubscriptionAutoRefreshPorts } from '../src/main/subscriptions/SubscriptionAutoRefreshService';
import { NullLogger } from '../src/engine/util/logger';

function ports(overrides: Partial<SubscriptionAutoRefreshPorts> = {}): SubscriptionAutoRefreshPorts {
  return {
    activeSubscriptionUrl: () => 'https://example.test/config',
    lastSuccessfulRefreshAt: vi.fn(() => 0),
    recordSuccessfulRefreshAt: vi.fn(),
    refresh: vi.fn(async () => ({ report: { ok: 3, skipped: 1, degraded: 0 } })),
    logger: NullLogger,
    ...overrides,
  };
}

describe('SubscriptionAutoRefreshService', () => {
  it('skips manual profiles and recent successful refreshes', async () => {
    const manual = ports({ activeSubscriptionUrl: () => '' });
    expect(await new SubscriptionAutoRefreshService(manual, () => 10_000).refreshIfDue()).toBe(false);
    expect(manual.refresh).not.toHaveBeenCalled();
    expect(manual.lastSuccessfulRefreshAt).not.toHaveBeenCalled();

    const recent = ports({ lastSuccessfulRefreshAt: () => 10_000 - 60_000 });
    expect(await new SubscriptionAutoRefreshService(recent, () => 10_000).refreshIfDue()).toBe(false);
    expect(recent.refresh).not.toHaveBeenCalled();
    expect(recent.recordSuccessfulRefreshAt).not.toHaveBeenCalled();
  });

  it('records the completion time only after a successful refresh', async () => {
    let now = 8 * 24 * 60 * 60 * 1000;
    const dependencies = ports({
      refresh: vi.fn(async () => {
        now += 2500;
        return { report: { ok: 3, skipped: 1, degraded: 0 } };
      }),
    });

    expect(await new SubscriptionAutoRefreshService(dependencies, () => now).refreshIfDue()).toBe(true);
    expect(dependencies.refresh).toHaveBeenCalledWith('https://example.test/config');
    expect(dependencies.recordSuccessfulRefreshAt).toHaveBeenCalledWith(now);
  });

  it('leaves the last success timestamp unchanged when import fails', async () => {
    const dependencies = ports({ refresh: vi.fn(async () => { throw new Error('network unavailable'); }) });

    expect(await new SubscriptionAutoRefreshService(dependencies, () => 8 * 24 * 60 * 60 * 1000).refreshIfDue()).toBe(false);
    expect(dependencies.recordSuccessfulRefreshAt).not.toHaveBeenCalled();
  });
});
