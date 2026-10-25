import { describe, expect, it } from 'vitest';
import { UserConfigApplicationService, type UserConfigPersistencePort } from '../src/main/store/UserConfigApplicationService';
import { subscriptionStamp } from '../src/main/store/userProfileNaming';
import { SubscriptionProfileImportService } from '../src/main/subscriptions/SubscriptionProfileImportService';
import { NullLogger } from '../src/engine/util/logger';
import type { SiteConfig, SourceBean, UserConfig } from '../src/shared/types';

function config(key: string): SiteConfig {
  return {
    sites: [{ key, name: key, type: 0, api: `https://${key}.test/api` } as SourceBean],
    parses: [], lives: [], flags: [], spider: '', jarCache: 'true', danmaku: '', wallpaper: '',
    hosts: {}, rules: [], doh: [], ads: [], proxy: [],
  };
}

class MemoryPersistence implements UserConfigPersistencePort {
  value: UserConfig | null = null;
  writes = 0;

  getObject<T>(_key: string, fallback: T): T {
    return (this.value ?? fallback) as T;
  }

  setObject<T>(_key: string, value: T): void {
    this.value = structuredClone(value as UserConfig);
  }

  flushStrict(): void {
    this.writes++;
  }
}

describe('SubscriptionProfileImportService', () => {
  const fixedNow = new Date('2026-10-23T04:05:06.000Z');

  it('archives an auto-named prior profile and activates the new profile in one persistence commit', () => {
    const persistence = new MemoryPersistence();
    const profiles = new UserConfigApplicationService(persistence, NullLogger, { now: () => fixedNow });
    profiles.replaceFromImport(config('old'), 'https://old.test/config');
    const oldId = profiles.activeProfileId();
    persistence.writes = 0;

    new SubscriptionProfileImportService(profiles, () => fixedNow).recordImportedConfig(
      config('new'), 'https://new.test/config', true,
    );

    const saved = profiles.snapshot();
    expect(persistence.writes).toBe(1);
    expect(saved.profiles.find((profile) => profile.id === oldId)?.name).toBe(`旧订阅 ${subscriptionStamp(fixedNow)}`);
    expect(saved.profiles.find((profile) => profile.id === saved.activeProfileId)?.name).toBe(`新订阅 ${subscriptionStamp(fixedNow)}`);
    expect(saved.sources.map((source) => source.key)).toEqual(['new']);
  });

  it('replaces the same remote profile and applies a custom name in one commit', () => {
    const persistence = new MemoryPersistence();
    const profiles = new UserConfigApplicationService(persistence, NullLogger, { now: () => fixedNow });
    profiles.replaceFromImport(config('old'), 'https://same.test/config');
    const profileId = profiles.activeProfileId();
    persistence.writes = 0;

    new SubscriptionProfileImportService(profiles, () => fixedNow).recordImportedConfig(
      config('updated'), 'https://same.test/config', true, '我的线路',
    );

    const saved = profiles.snapshot();
    expect(persistence.writes).toBe(1);
    expect(saved.profiles).toHaveLength(1);
    expect(saved.activeProfileId).toBe(profileId);
    expect(saved.profiles[0].name).toBe('我的线路');
    expect(saved.sources.map((source) => source.key)).toEqual(['updated']);
  });

  it('restores sources deleted by the user only for an explicit import, in the same commit', () => {
    const persistence = new MemoryPersistence();
    const profiles = new UserConfigApplicationService(persistence, NullLogger, { now: () => fixedNow });
    profiles.replaceFromImport(config('source'), 'https://same.test/config');
    profiles.deleteSource('source');
    persistence.writes = 0;

    new SubscriptionProfileImportService(profiles, () => fixedNow).recordImportedConfig(
      config('source'), 'https://same.test/config', true,
    );

    const saved = profiles.snapshot();
    expect(persistence.writes).toBe(1);
    expect(saved.sources.map((source) => source.key)).toEqual(['source']);
    expect(saved.deletedSourceKeys).toEqual([]);
  });

  it('keeps auto refresh in place and does not restore user-deleted source keys', () => {
    const persistence = new MemoryPersistence();
    const profiles = new UserConfigApplicationService(persistence, NullLogger, { now: () => fixedNow });
    profiles.replaceFromImport(config('old'), 'https://same.test/config');
    const profileId = profiles.activeProfileId();
    profiles.deleteSource('old');

    new SubscriptionProfileImportService(profiles, () => fixedNow).recordImportedConfig(
      config('old'), 'https://same.test/config', false,
    );

    const saved = profiles.snapshot();
    expect(saved.activeProfileId).toBe(profileId);
    expect(saved.sources).toEqual([]);
    expect(saved.deletedSourceKeys).toEqual(['old']);
  });
});
