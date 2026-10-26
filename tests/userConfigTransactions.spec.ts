import { describe, expect, it, vi } from 'vitest';
import { UserConfigApplicationService, type UserConfigPersistencePort } from '../src/main/store/UserConfigApplicationService';
import { NullLogger } from '../src/engine/util/logger';
import type { SiteConfig, SourceBean, UserConfig } from '../src/shared/types';

function importedConfig(key: string): SiteConfig {
  return {
    sites: [{ key, name: key, type: 0, api: `https://${key}.test/api` } as SourceBean],
    lives: [], parses: [], flags: [], spider: '', jarCache: 'true', danmaku: '', wallpaper: '',
    hosts: {}, rules: [], doh: [], ads: [], proxy: [],
  };
}

class FailingPersistence implements UserConfigPersistencePort {
  value: UserConfig | null = null;
  failNext = false;
  flushes = 0;
  getObject<T>(_key: string, fallback: T): T { return (this.value ?? fallback) as T; }
  setObject<T>(_key: string, value: T): void { this.value = structuredClone(value as UserConfig); }
  flushStrict(): void {
    this.flushes++;
    if (!this.failNext) return;
    this.failNext = false;
    throw new Error('disk write failed');
  }
}

describe('user-config transaction isolation', () => {
  const mutations: Array<[string, (service: UserConfigApplicationService, oldId: string) => void]> = [
    ['subscription replacement', (service) => service.replaceFromImport(importedConfig('replacement'), 'https://replacement.test/config')],
    ['saving an imported profile', (service) => { service.saveAsProfile('Replacement', { parsed: importedConfig('replacement') }); }],
    ['archiving and saving an imported profile', (service) => {
      service.saveImportedAsProfile('Replacement', importedConfig('replacement'), 'https://replacement.test/config', 'Archived', []);
    }],
    ['profile activation with a selected source', (service, oldId) => service.activateProfile(oldId, 'old')],
  ];

  it.each(mutations)('rolls back selection and runtime/profile state when %s fails to persist', (_name, mutate) => {
    const persistence = new FailingPersistence();
    const service = new UserConfigApplicationService(persistence, NullLogger, { now: () => new Date('2026-10-23T06:00:00Z') });
    service.replaceFromImport(importedConfig('old'), 'https://old.test/config');
    const oldId = service.activeProfileId();
    service.saveAsProfile('Current', { parsed: importedConfig('current'), apiUrl: 'https://current.test/config' });
    service.setActiveSource('current');
    const before = service.snapshot();
    const revision = service.revision;
    const onChange = vi.fn();
    service.setOnChange(onChange);
    persistence.failNext = true;

    expect(() => mutate(service, oldId)).toThrow('disk write failed');
    expect(service.snapshot()).toEqual(before);
    expect(persistence.value).toEqual(before);
    expect(service.revision).toBe(revision);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a durable commit when runtime sync throws, then retries sync without another write', () => {
    const persistence = new FailingPersistence();
    const service = new UserConfigApplicationService(persistence, NullLogger);
    service.replaceFromImport(importedConfig('initial'), 'https://initial.test/config');
    let syncFailure = 'runtime projection failed';
    const onChange = vi.fn(() => { if (syncFailure) throw new Error(syncFailure); });
    service.setOnChange(onChange);
    const revisionBefore = service.revision;
    const flushesBefore = persistence.flushes;

    expect(() => service.addSource({ ...importedConfig('saved').sites[0] })).not.toThrow();
    expect(service.snapshot().sources.map(source => source.key)).toContain('saved');
    expect(persistence.value?.sources.map(source => source.key)).toContain('saved');
    expect(service.revision).toBe(revisionBefore + 1);
    expect(persistence.flushes).toBe(flushesBefore + 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(service.lastCommitOutcome).toMatchObject({
      status: 'committed-runtime-sync-failed',
      revision: service.revision,
      error: { name: 'Error', message: 'runtime projection failed' },
    });
    expect(service.pendingRuntimeSyncRevision).toBe(service.revision);

    syncFailure = 'retry sync failed';
    expect(service.retryRuntimeSync()).toMatchObject({
      status: 'runtime-sync-failed', revision: service.revision,
      error: { name: 'Error', message: 'retry sync failed' },
    });
    expect(persistence.flushes).toBe(flushesBefore + 1);
    expect(service.revision).toBe(revisionBefore + 1);
    expect(service.pendingRuntimeSyncRevision).toBe(service.revision);

    syncFailure = '';
    expect(service.retryRuntimeSync()).toEqual({ status: 'synchronized', revision: service.revision });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(persistence.flushes).toBe(flushesBefore + 1);
    expect(service.revision).toBe(revisionBefore + 1);
    expect(service.pendingRuntimeSyncRevision).toBeNull();
    expect(service.lastCommitOutcome).toEqual({ status: 'committed', revision: service.revision, runtimeSync: 'synchronized' });
  });

  it('keeps failed content sync pending across UI-only commits and retries with the latest snapshot', () => {
    const persistence = new FailingPersistence();
    const service = new UserConfigApplicationService(persistence, NullLogger);
    service.replaceFromImport(importedConfig('initial'), 'https://initial.test/config');
    let failSync = true;
    const onChange = vi.fn((_snapshot: UserConfig, _kind: 'content' | 'ui') => {
      if (failSync) throw new Error('runtime projection failed');
    });
    service.setOnChange(onChange);
    service.addSource({ ...importedConfig('saved').sites[0] });
    const contentRevision = service.revision;
    expect(service.pendingRuntimeSyncRevision).toBe(contentRevision);

    failSync = false;
    const flushesBeforeUiCommit = persistence.flushes;
    service.setActiveSource('saved');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ui: expect.objectContaining({ activeSourceKey: 'saved' }) }), 'ui');
    expect(service.lastCommitOutcome).toEqual({ status: 'committed', revision: service.revision, runtimeSync: 'pending' });
    expect(service.pendingRuntimeSyncRevision).toBe(service.revision);

    expect(service.retryRuntimeSync()).toEqual({ status: 'synchronized', revision: service.revision });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ui: expect.objectContaining({ activeSourceKey: 'saved' }) }), 'content');
    expect(service.pendingRuntimeSyncRevision).toBeNull();
    expect(persistence.flushes).toBe(flushesBeforeUiCommit + 1);
  });

  it('keeps caller edits to returned source categories outside the authoritative state', () => {
    const service = new UserConfigApplicationService(new FailingPersistence(), NullLogger);
    const created = service.addSource({ ...importedConfig('source').sites[0], categories: ['Movies'] });
    created.categories!.push('Caller edit');
    expect(service.snapshot().sources[0].categories).toEqual(['Movies']);

    const listed = service.sources();
    listed[0].categories!.push('Another edit');
    expect(service.snapshot().sources[0].categories).toEqual(['Movies']);

    const updated = service.updateSource('source', { categories: ['TV'] });
    updated.categories!.push('Yet another edit');
    expect(service.snapshot().sources[0].categories).toEqual(['TV']);
  });
});
