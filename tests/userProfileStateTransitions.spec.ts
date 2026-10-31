import { describe, expect, it } from 'vitest';
import { emptyUserConfig } from '../src/main/store/UserConfigApplicationService';
import { createProfileFromConfig, replaceImportedProfileConfig } from '../src/main/store/userProfileImports';
import { activateProfileInConfig, deleteProfileFromConfig } from '../src/main/store/userProfileTransitions';
import { commitSubscriptionGroupInConfig } from '../src/main/store/subscriptionGroupTransitions';
import { serializeImport } from '../src/main/store/userProfileSnapshot';
import type { LiveBean, SiteConfig, SourceBean, SubscriptionGroup, UserConfig, UserProfile } from '../src/shared/types';

const now = new Date('2026-10-23T06:00:00Z');
function site(key: string): SourceBean { return { key, name: key, type: 0, api: `https://${key}.test/api` } as SourceBean; }
function config(...keys: string[]): SiteConfig {
  return { sites: keys.map(site), lives: [], parses: [], flags: [], spider: '', jarCache: 'true', danmaku: '', wallpaper: '', hosts: {}, rules: [], doh: [], ads: [], proxy: [] };
}
const localLive: LiveBean = {
  name: 'Local playlist', url: 'http://127.0.0.1:9978/file/local-live/channels.m3u', api: '', type: '0',
  jar: '', ext: '', epg: '', playerType: '', timeout: 10,
};
function profile(id: string, ...keys: string[]): UserProfile {
  return { id, name: `新订阅 ${id}`, apiUrl: `https://${id}.test/config`, json: serializeImport(config(...keys)), sourceCount: keys.length, importedAt: now.toISOString() };
}
function currentState(): UserConfig {
  return {
    ...emptyUserConfig(), activeProfileId: 'current', sources: [site('current')], lives: [{ ...localLive }],
    profiles: [profile('current', 'current'), profile('target', 'target', 'deleted')],
    deletedSourceKeysByProfile: { target: ['deleted'] }, ui: { activeSourceKey: 'current', activeLiveIndex: 0 },
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('pure profile state transitions', () => {
  it('replaces a subscription deterministically without mutating the old selection or imported payload', () => {
    const state = freeze(currentState());
    const imported = freeze(config('replacement'));
    const options = { now, version: 4, restoreDeletedSourceKeys: [] };
    const result = replaceImportedProfileConfig(state, imported, 'https://replacement.test/config', options);

    expect(result).toEqual(replaceImportedProfileConfig(state, imported, 'https://replacement.test/config', options));
    expect(result.config.sources.map((source) => source.key)).toEqual(['replacement']);
    expect(result.config.ui.activeSourceKey).toBe('');
    expect(result.config.lives).toEqual([localLive]);
    expect(state.ui.activeSourceKey).toBe('current');
  });

  it('creates and archives profiles as a proposed state while the old profile stays active in the input', () => {
    const state = freeze(currentState());
    const result = createProfileFromConfig(state, 'Imported', { parsed: freeze(config('new')) }, { now, previousProfileName: 'Archived' });

    expect(result.config.activeProfileId).toBe(result.profile.id);
    expect(result.config.profiles.find((item) => item.id === 'current')?.name).toBe('Archived');
    expect(result.config.ui.activeSourceKey).toBe('');
    expect(result.config.lives).toEqual([localLive]);
    expect(state.activeProfileId).toBe('current');
    expect(state.profiles[0].name).toBe('新订阅 current');
    expect(state.ui.activeSourceKey).toBe('current');
  });

  it('clamps the selected live line after saving a profile with fewer portable lines', () => {
    const state = currentState();
    state.lives = [
      { ...localLive, url: 'https://live.test/first.m3u' },
      { ...localLive, url: 'https://live.test/second.m3u' },
    ];
    state.ui.activeLiveIndex = 1;
    const result = createProfileFromConfig(freeze(state), 'No live lines', { parsed: freeze(config('new')) }, { now });

    expect(result.config.lives).toEqual([]);
    expect(result.config.ui.activeLiveIndex).toBe(0);
    expect(state.ui.activeLiveIndex).toBe(1);
  });

  it('activates a profile with its own deletion scope and preserves machine-local live subscriptions', () => {
    const state = freeze(currentState());
    const result = activateProfileInConfig(state, 'target', 'target');

    expect(result.config.activeProfileId).toBe('target');
    expect(result.config.sources.map((source) => source.key)).toEqual(['target']);
    expect(result.filteredSourceKeys).toEqual(['deleted']);
    expect(result.config.ui.activeSourceKey).toBe('target');
    expect(result.config.lives).toEqual([localLive]);
    expect(state.ui.activeSourceKey).toBe('current');
  });

  it('keeps local playlists when a multi-repository member replaces the active profile', () => {
    const state = freeze(currentState());
    const imported = { ...profile('child', 'new'), groupId: 'group', memberId: 'member' };
    const group: SubscriptionGroup = {
      id: 'group', name: 'Group', url: 'https://group.test/config', status: 'complete',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
      members: [{ id: 'member', profileId: imported.id, name: imported.name, url: imported.apiUrl, status: 'ready' }],
    };
    const result = commitSubscriptionGroupInConfig(state, freeze(group), freeze([imported]), imported.id);

    expect(result.config.activeProfileId).toBe(imported.id);
    expect(result.config.sources.map((source) => source.key)).toEqual(['new']);
    expect(result.config.lives).toEqual([localLive]);
    expect(result.config.ui.activeSourceKey).toBe('');
    expect(state.activeProfileId).toBe('current');
    expect(state.ui.activeSourceKey).toBe('current');
  });

  it('removes a deleted profile from its subscription group instead of leaving an orphan switcher row', () => {
    const state = currentState();
    state.profiles.push(profile('other', 'other'));
    state.subscriptionGroups = [{
      id: 'group', name: 'Group', url: 'https://group.test/config', status: 'partial',
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
      members: [
        { id: 'current-member', profileId: 'current', name: 'Current', url: 'https://current.test/config', status: 'ready' },
        { id: 'failed-member', name: 'Failed child', url: 'https://failed.test/config', status: 'failed', error: 'HTTP 404' },
      ],
    }];

    const result = deleteProfileFromConfig(state, 'current');

    expect(result?.config.subscriptionGroups[0].members).toEqual([state.subscriptionGroups[0].members[1]]);
    expect(result?.config.subscriptionGroups[0].status).toBe('failed');
  });
});
