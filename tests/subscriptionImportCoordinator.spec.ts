import { describe, expect, it, vi } from 'vitest';
import type { Logger, SiteConfig, SubscriptionGroup, UserProfile } from '../src/shared/types';
import {
  SubscriptionImportCoordinator,
  type SubscriptionImportCoordinatorPorts,
} from '../src/main/subscriptions/SubscriptionImportCoordinator';
import type { SubscriptionGroupProfilePort } from '../src/main/subscriptions/SubscriptionImportGroupService';

const childConfig = '{"sites":[{"key":"a","name":"A","type":0,"api":"https://example.test/api"}]}';

function createProfiles() {
  type Snapshot = ReturnType<SubscriptionGroupProfilePort['snapshot']>;
  let revision = 1;
  let state: Snapshot = { subscriptionGroups: [], profiles: [], activeProfileId: '' };
  const commitSubscriptionGroup = vi.fn((
    group: SubscriptionGroup,
    profiles: UserProfile[],
  ) => {
    state = { ...state, subscriptionGroups: [group], profiles };
    revision++;
  });
  const manager = {
    get revision() { return revision; },
    snapshot: () => state,
    commitSubscriptionGroup,
  } satisfies SubscriptionGroupProfilePort;
  return { manager, commitSubscriptionGroup };
}

function createPorts(overrides: Partial<SubscriptionImportCoordinatorPorts> = {}) {
  const profiles = createProfiles();
  let currentConfig: SiteConfig | null = null;
  const ports: SubscriptionImportCoordinatorPorts = {
    profiles: profiles.manager,
    fetchConfigWithDiagnostics: vi.fn(async () => ({ text: childConfig, hint: 'HTTP 拉取诊断' })),
    currentConfig: () => currentConfig,
    setCurrentConfig: vi.fn((config) => { currentConfig = config; }),
    applyRuntimeConfig: vi.fn(),
    recordImportedConfig: vi.fn(),
    logger: { i: vi.fn() } as unknown as Logger,
    ...overrides,
  };
  return { ports, profiles };
}

describe('SubscriptionImportCoordinator', () => {
  it('imports the explicitly selected child and preserves the fetch diagnostic', async () => {
    const { ports } = createPorts();
    const coordinator = new SubscriptionImportCoordinator(ports);

    const result = await coordinator.importMultiRepository({
      items: [
        { url: 'https://example.test/first.json', name: 'First' },
        { url: 'https://example.test/selected.json', name: 'Selected' },
      ],
    }, {
      snapshot: true,
      name: 'Chosen source',
      preferredLine: 1,
      subscriptionUrl: 'https://example.test/root.json#line=1',
    });

    expect(ports.fetchConfigWithDiagnostics).toHaveBeenCalledWith('https://example.test/selected.json', false, undefined);
    expect(ports.recordImportedConfig).toHaveBeenCalledWith(
      result.config,
      'https://example.test/selected.json',
      true,
      'Chosen source',
    );
    expect(result.warnings?.at(-1)).toContain('HTTP 拉取诊断');
    expect(coordinator.latestReport).toBe(result.report);
  });

  it('commits successful children through the profile port and returns the aggregate summary', async () => {
    const { ports, profiles } = createPorts({
      fetchConfigWithDiagnostics: vi.fn(async () => ({ text: childConfig, hint: '' })),
    });
    const coordinator = new SubscriptionImportCoordinator(ports);

    const result = await coordinator.importMultiRepository({
      items: [{ url: 'https://example.test/child.json', name: 'Child' }],
    }, {
      snapshot: true,
      name: 'Group',
      subscriptionUrl: 'https://example.test/root.json',
    });

    expect(profiles.commitSubscriptionGroup).toHaveBeenCalledOnce();
    expect(profiles.manager.snapshot().subscriptionGroups[0]).toMatchObject({ status: 'complete', members: [{ status: 'ready' }] });
    expect(result.warnings?.at(-1)).toContain('成功 1、失败 0');
    expect(coordinator.latestReport).toBe(result.report);
  });

  it('owns the latest report for a single-config import and commits through profile/runtime ports', async () => {
    const { ports } = createPorts();
    const coordinator = new SubscriptionImportCoordinator(ports);

    const result = await coordinator.importConfig({ json: childConfig, name: 'Direct import' }, { snapshot: true });

    expect(ports.fetchConfigWithDiagnostics).not.toHaveBeenCalled();
    expect(ports.recordImportedConfig).toHaveBeenCalledWith(result.config, '', true, 'Direct import');
    expect(ports.setCurrentConfig).toHaveBeenCalledWith(result.config);
    expect(ports.applyRuntimeConfig).toHaveBeenCalledWith(result.config);
    expect(ports.currentConfig()).toBe(result.config);
    expect(coordinator.latestReport).toBe(result.report);
  });
});
