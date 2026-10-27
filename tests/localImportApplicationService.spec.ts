import { describe, expect, it, vi } from 'vitest';
import type { ConfigImportResult, LiveBean, SourceBean, UserConfig } from '../src/shared/types';
import {
  LocalImportApplicationService,
  type ImportedLocalPackage,
  type LocalImportApplicationOptions,
  type LocalPackageInspection,
} from '../src/main/configuration/LocalImportApplicationService';

function configuration(): UserConfig {
  return { marker: 'current' } as unknown as UserConfig;
}

function configImportResult(): ConfigImportResult {
  return { config: {} as ConfigImportResult['config'], report: {} as ConfigImportResult['report'], warnings: [] };
}

function packageResult(overrides: Partial<ImportedLocalPackage> = {}): ImportedLocalPackage {
  return { index: 3, rel: '影视.json', sites: 2, warnings: [], ...overrides };
}

function makeOptions(overrides: Partial<LocalImportApplicationOptions> = {}): LocalImportApplicationOptions {
  const live = { name: 'live', api: '', type: '0', url: '', jar: '', ext: '', epg: '', playerType: '', timeout: 10 } as LiveBean;
  return {
    pythonFiles: { copyPython: path => `file:///managed/${path}`, discard: vi.fn() },
    sources: { addSource: source => source, getSnapshot: () => configuration() },
    packages: {
      inspect: (_root: string): LocalPackageInspection | null => ({ sites: 2 }),
      copyAndRegister: (_root: string, _name?: string) => packageResult(),
      rootOf: (_index: number) => '/managed/package',
      discard: vi.fn(),
    },
    subscriptions: { importConfig: async (_input: { url: string; name: string }) => configImportResult() },
    liveFiles: { import: (path, nameOverride) => ({ fileName: 'source.m3u', name: nameOverride || 'source', needsName: !nameOverride }) },
    liveChannels: { add: (_channel: LiveBean) => ({ index: 0, replaced: false }), count: () => 1 },
    packageUrl: (index, rel) => `pkg://${index}/${rel}`,
    liveChannel: (_name, _fileName) => live,
    logger: { warn: vi.fn() },
    ...overrides,
  };
}

describe('LocalImportApplicationService', () => {
  it('keeps successful Python files when another file fails registration', () => {
    const options = makeOptions({
      sources: {
        addSource: source => {
          if (source.name === 'broken') throw new Error('source config rejected');
          return source;
        },
        getSnapshot: () => configuration(),
      },
    });
    const service = new LocalImportApplicationService(options);

    const result = service.importPythonFiles(['good.py', 'broken.py']);

    expect(result).toMatchObject({ ok: true, key: 'good', keys: ['good'], imported: 1 });
    expect(result.failed).toEqual([{ name: 'broken', error: 'source config rejected' }]);
    expect(options.pythonFiles.discard).toHaveBeenCalledWith('file:///managed/broken.py', expect.any(Object));
  });

  it('reports compensation failure for a failed Python registration', () => {
    const logger = { warn: vi.fn() };
    const discard = vi.fn(() => { throw new Error('disk is read-only'); });
    const options = makeOptions({
      pythonFiles: { copyPython: path => `file:///managed/${path}`, discard },
      sources: { addSource: (_source: SourceBean) => { throw new Error('registration failed'); }, getSnapshot: () => configuration() },
      logger,
    });

    const result = new LocalImportApplicationService(options).importPythonFiles(['bad.py']);

    expect(result).toMatchObject({ ok: false });
    expect(result.failed?.[0]?.error).toContain('副本清理失败：disk is read-only');
    expect(logger.warn).toHaveBeenCalledWith('本地 Python 副本清理失败：disk is read-only');
  });

  it('does not copy a Python-only package until a name is provided', async () => {
    const copyAndRegister = vi.fn(() => packageResult());
    const importConfig = vi.fn(async () => configImportResult());
    const options = makeOptions({
      packages: {
        inspect: (_root: string) => ({ generated: true, sites: 4 }),
        copyAndRegister,
        rootOf: (_index: number) => '/managed/package',
        discard: vi.fn(),
      },
      subscriptions: { importConfig },
    });

    const result = await new LocalImportApplicationService(options).importPackage('/picked/python-dir');

    expect(result).toEqual({ ok: false, needsName: true, root: '/picked/python-dir', sites: 4 });
    expect(copyAndRegister).not.toHaveBeenCalled();
    expect(importConfig).not.toHaveBeenCalled();
  });

  it('compensates a failed package registration using the latest concurrent config snapshot', async () => {
    const latestConfig = { marker: 'concurrent-config-commit' } as unknown as UserConfig;
    const discard = vi.fn();
    const importConfig = vi.fn(async () => {
      throw new Error('subscription import failed');
    });
    const options = makeOptions({
      sources: { addSource: source => source, getSnapshot: () => latestConfig },
      packages: {
        inspect: (_root: string) => ({ generated: false, sites: 5 }),
        copyAndRegister: (_root: string, _name?: string) => packageResult(),
        rootOf: (_index: number) => '/managed/package',
        discard,
      },
      subscriptions: { importConfig },
    });

    const result = await new LocalImportApplicationService(options).importPackage('/picked/package');

    expect(importConfig).toHaveBeenCalledWith({ url: 'pkg://3/影视.json', name: 'package' });
    expect(discard).toHaveBeenCalledWith('pkg://3/影视.json', latestConfig);
    expect(result).toMatchObject({ ok: false, error: 'subscription import failed' });
  });

  it('surfaces package cleanup failures alongside the import failure', async () => {
    const logger = { warn: vi.fn() };
    const options = makeOptions({
      packages: {
        inspect: (_root: string) => ({ sites: 1 }),
        copyAndRegister: (_root: string, _name?: string) => packageResult(),
        rootOf: (_index: number) => '/managed/package',
        discard: () => { throw new Error('cleanup denied'); },
      },
      subscriptions: { importConfig: async (_input: { url: string; name: string }) => { throw new Error('registration failed'); } },
      logger,
    });

    const result = await new LocalImportApplicationService(options).importPackage('/picked/package');

    expect(result).toMatchObject({ ok: false, error: 'registration failed', warnings: ['本地包副本清理失败：cleanup denied'] });
    expect(logger.warn).toHaveBeenCalledWith('本地包副本清理失败：cleanup denied');
  });

  it('keeps live-file naming separate from live-channel registration', () => {
    const add = vi.fn((_channel: LiveBean) => ({ index: 2, replaced: true }));
    const importFile = vi.fn((_path: string, nameOverride: string) => ({
      fileName: 'picked.m3u', name: nameOverride || 'picked', needsName: !nameOverride,
    }));
    const service = new LocalImportApplicationService(makeOptions({
      liveFiles: { import: importFile },
      liveChannels: { add, count: () => 7 },
    }));

    const pending = service.importLiveFile('/picked/picked.m3u');
    const registered = service.importLiveFile('/picked/picked.m3u', '命名后的线路');

    expect(pending).toEqual({ ok: true, needsName: true, path: '/picked/picked.m3u', name: 'picked' });
    expect(add).toHaveBeenCalledTimes(1);
    expect(registered).toMatchObject({ ok: true, name: '命名后的线路', index: 2, replaced: true, total: 7 });
  });

  it('reports live channel registration failure without claiming success', () => {
    const service = new LocalImportApplicationService(makeOptions({
      liveFiles: { import: (_path, nameOverride) => ({ fileName: 'source.m3u', name: nameOverride, needsName: false }) },
      liveChannels: { add: (_channel: LiveBean) => { throw new Error('live config rejected'); }, count: () => 0 },
    }));

    expect(service.importLiveFile('/picked/source.m3u', 'source')).toEqual({ ok: false, error: 'live config rejected' });
  });
});
