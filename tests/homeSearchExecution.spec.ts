import { describe, expect, it, vi } from 'vitest';
import type { SearchAllReport } from '../src/shared/types';
import type { HomeSearchPort } from '../src/renderer/features/home/application/homePorts';
import { executeHomeSearch, type HomeSearchExecutionPorts } from '../src/renderer/features/home/application/homeSearchExecution';

function report(): SearchAllReport {
  return { items: [], perSource: [], hitSources: 0, failedSources: 0, totalRaw: 0 };
}

function createPorts(overrides: Partial<HomeSearchPort> = {}) {
  const api: HomeSearchPort = {
    onSearchAllProgress: vi.fn(() => () => undefined),
    searchAll: vi.fn(async () => report()),
    search: vi.fn(async () => []),
    category: vi.fn(async () => ({ items: [], sortClasses: [], page: 1, pagecount: 1, total: 0 })),
    ...overrides,
  };
  const ports: HomeSearchExecutionPorts = {
    api,
    aggregateClock: { schedule: () => 1, cancel: () => undefined },
    wallClock: { now: () => 10 },
    publishPartialReport: vi.fn(),
    publishProgress: vi.fn(),
  };
  return { api, ports };
}

describe('executeHomeSearch', () => {
  it('runs the selected source through the single-source adapter', async () => {
    const api = createPorts({ search: vi.fn(async () => []) });
    const result = await executeHomeSearch({
      term: 'show', refresh: false,
      scope: { kind: 'current', profileId: 'profile-a', source: { key: 'source-a', name: 'Source A' } },
      isCurrent: () => true,
    }, api.ports);

    expect(api.api.search).toHaveBeenCalledWith({ key: 'source-a', wd: 'show', profileId: 'profile-a' });
    expect(result).toMatchObject({ kind: 'completed', scope: 'current' });
  });

  it('passes cancellation signals through current-source and aggregate search paths', async () => {
    const controller = new AbortController();
    const current = createPorts({ search: vi.fn(async () => []) });
    await executeHomeSearch({
      term: 'show', refresh: false,
      scope: { kind: 'current', profileId: 'profile-a', source: { key: 'source-a', name: 'Source A' } },
      signal: controller.signal,
      isCurrent: () => true,
    }, current.ports);
    expect(current.api.search).toHaveBeenCalledWith(
      { key: 'source-a', wd: 'show', profileId: 'profile-a' }, controller.signal,
    );

    const aggregate = createPorts({ searchAll: vi.fn(async () => report()) });
    await executeHomeSearch({
      term: 'show', refresh: false,
      scope: { kind: 'all', profileId: 'profile-a' },
      signal: controller.signal,
      isCurrent: () => true,
    }, aggregate.ports);
    expect(aggregate.api.searchAll).toHaveBeenCalledWith(
      'show', { refresh: false, profileId: 'profile-a' }, controller.signal,
    );
  });

  it('uses the selected profile for aggregate search across its sources', async () => {
    const api = createPorts({ searchAll: vi.fn(async () => report()) });
    const result = await executeHomeSearch({
      term: 'show', refresh: true,
      scope: { kind: 'all', profileId: 'profile-a' },
      isCurrent: () => true,
    }, api.ports);

    expect(api.api.searchAll).toHaveBeenCalledWith('show', { refresh: true, profileId: 'profile-a' });
    expect(result).toMatchObject({ kind: 'completed', scope: 'all', report: report() });
  });

  it('uses the explicit profile list and fails fast when the list is empty', async () => {
    const api = createPorts({ searchAll: vi.fn(async () => report()) });
    const completed = await executeHomeSearch({
      term: 'show', refresh: false,
      scope: { kind: 'all-profiles', profileIds: ['profile-a', 'profile-b'] },
      isCurrent: () => true,
    }, api.ports);
    const empty = await executeHomeSearch({
      term: 'show', refresh: false,
      scope: { kind: 'all-profiles', profileIds: [] },
      isCurrent: () => true,
    }, api.ports);

    expect(api.api.searchAll).toHaveBeenCalledOnce();
    expect(api.api.searchAll).toHaveBeenCalledWith('show', { refresh: false, profileIds: ['profile-a', 'profile-b'] });
    expect(completed).toMatchObject({ kind: 'completed', scope: 'all-profiles' });
    expect(empty).toEqual({ kind: 'no-profiles' });
  });

  it('reports a missing source without calling the API', async () => {
    const api = createPorts();
    const result = await executeHomeSearch({
      term: 'show', refresh: false,
      scope: { kind: 'current', profileId: 'profile-a', source: null },
      isCurrent: () => true,
    }, api.ports);

    expect(result).toEqual({ kind: 'no-source' });
    expect(api.api.search).not.toHaveBeenCalled();
    expect(api.api.searchAll).not.toHaveBeenCalled();
  });

  it('preserves aggregate failures and stale request outcomes as distinct results', async () => {
    const failedApi = createPorts({ searchAll: vi.fn(async () => { throw new Error('offline'); }) });
    const failed = await executeHomeSearch({
      term: 'show', refresh: false,
      scope: { kind: 'all', profileId: 'profile-a' },
      isCurrent: () => true,
    }, failedApi.ports);
    const staleApi = createPorts({ searchAll: vi.fn(async () => report()) });
    const stale = await executeHomeSearch({
      term: 'show', refresh: false,
      scope: { kind: 'all', profileId: 'profile-a' },
      isCurrent: () => false,
    }, staleApi.ports);

    expect(failed).toEqual({ kind: 'failed', message: 'offline' });
    expect(stale).toEqual({ kind: 'stale' });
  });
});
