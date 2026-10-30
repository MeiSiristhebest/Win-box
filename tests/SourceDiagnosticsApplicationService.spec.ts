import { describe, expect, it, vi } from 'vitest';
import type { SourceBean } from '../src/shared/types';
import { SourceDiagnosticsApplicationService } from '../src/main/spider/SourceDiagnosticsApplicationService';

const source = {
  key: 'catalog',
  name: 'Catalog',
  type: 0,
  api: 'https://catalog.example/api.php/provide/vod',
} as SourceBean;

describe('SourceDiagnosticsApplicationService', () => {
  it('audits the current source snapshot through the catalog and gateway ports', async () => {
    const home = { items: [{ vod_id: '1' }], sortClasses: [{ type_id: '1' }] };
    const service = new SourceDiagnosticsApplicationService({
      catalog: {
        currentSources: () => [source],
        activeProfileId: () => 'profile-a',
        findSource: (key) => key === source.key ? source : null,
      },
      gateway: { home: vi.fn(async () => home) },
      http: { request: vi.fn() },
      logger: { i: vi.fn(), w: vi.fn(), e: vi.fn() },
      globalSpiderJar: () => '',
      withTimeout: async (operation) => operation,
      now: () => 100,
    });

    await expect(service.auditAll()).resolves.toMatchObject([
      { key: source.key, items: 1, classes: 1, ms: 0 },
    ]);
  });

  it('reports a missing source before attempting network or spider operations', async () => {
    const request = vi.fn();
    const home = vi.fn();
    const service = new SourceDiagnosticsApplicationService({
      catalog: { currentSources: () => [], activeProfileId: () => 'profile-a', findSource: () => null },
      gateway: { home },
      http: { request },
      logger: { i: vi.fn(), w: vi.fn(), e: vi.fn() },
      globalSpiderJar: () => '',
      withTimeout: async (operation) => operation,
      now: () => 100,
    });

    await expect(service.debug('missing')).rejects.toThrow('源不存在: missing');
    expect(request).not.toHaveBeenCalled();
    expect(home).not.toHaveBeenCalled();
  });

  it('rejects an audit request whose profile is no longer active', async () => {
    const home = vi.fn();
    const service = new SourceDiagnosticsApplicationService({
      catalog: { currentSources: () => [source], activeProfileId: () => 'profile-b', findSource: () => source },
      gateway: { home },
      http: { request: vi.fn() },
      logger: { i: vi.fn(), w: vi.fn(), e: vi.fn() },
      globalSpiderJar: () => '',
      withTimeout: async (operation) => operation,
      now: () => 100,
    });

    await expect(service.auditAll('profile-a')).rejects.toThrow('配置档案已切换');
    expect(home).not.toHaveBeenCalled();
  });

  it('discards results when the active profile changes while the audit is awaiting a source', async () => {
    const homeResult = { items: [{ vod_id: '1' }], sortClasses: [{ type_id: '1' }] };
    let releaseHome!: (value: typeof homeResult) => void;
    let markHomeStarted!: () => void;
    const homeStarted = new Promise<void>((resolve) => { markHomeStarted = resolve; });
    let activeProfileId = 'profile-a';
    const home = vi.fn(() => {
      markHomeStarted();
      return new Promise<typeof homeResult>((resolve) => { releaseHome = resolve; });
    });
    const service = new SourceDiagnosticsApplicationService({
      catalog: {
        currentSources: () => [source],
        activeProfileId: () => activeProfileId,
        findSource: (key) => key === source.key ? source : null,
      },
      gateway: { home },
      http: { request: vi.fn() },
      logger: { i: vi.fn(), w: vi.fn(), e: vi.fn() },
      globalSpiderJar: () => '',
      withTimeout: async (operation) => operation,
      now: () => 100,
    });

    const audit = service.auditAll();
    await homeStarted;
    activeProfileId = 'profile-b';
    releaseHome(homeResult);

    await expect(audit).rejects.toThrow('配置档案已切换，请重新体检');
  });

  it('discards results when source settings change while the audit is awaiting a source', async () => {
    const homeResult = { items: [{ vod_id: '1' }], sortClasses: [{ type_id: '1' }] };
    let releaseHome!: (value: typeof homeResult) => void;
    let markHomeStarted!: () => void;
    const homeStarted = new Promise<void>((resolve) => { markHomeStarted = resolve; });
    let currentSources: SourceBean[] = [source];
    const service = new SourceDiagnosticsApplicationService({
      catalog: {
        currentSources: () => currentSources,
        activeProfileId: () => 'profile-a',
        findSource: (key) => key === source.key ? source : null,
      },
      gateway: {
        home: vi.fn(() => {
          markHomeStarted();
          return new Promise<typeof homeResult>((resolve) => { releaseHome = resolve; });
        }),
      },
      http: { request: vi.fn() },
      logger: { i: vi.fn(), w: vi.fn(), e: vi.fn() },
      globalSpiderJar: () => '',
      withTimeout: async (operation) => operation,
      now: () => 100,
    });

    const audit = service.auditAll('profile-a');
    await homeStarted;
    currentSources = [{ ...source, timeout: 45 }];
    releaseHome(homeResult);

    await expect(audit).rejects.toThrow('线路列表已变化，请重新体检');
  });
});
