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
      catalog: { currentSources: () => [], findSource: () => null },
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
});
