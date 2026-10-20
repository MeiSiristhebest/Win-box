import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/main/util/logger', () => ({
  fileLogger: { i: () => undefined, w: () => undefined, e: () => undefined },
}));
import { SpiderHost } from '../src/main/spider/SpiderHost';
import type { SourceBean } from '../src/shared/types';

describe('SpiderHost.searchAll across profiles', () => {
  it('runs profiles concurrently within the shared 24-source worker budget', async () => {
    const profileIds = ['profile-a', 'profile-b', 'profile-c'];
    const profiles = profileIds.map((id) => ({ id, name: id }));
    const sitesByProfile = new Map(profileIds.map((profileId) => [
      profileId,
      Array.from({ length: 8 }, (_, index) => ({
        key: `${profileId}-${index}`,
        name: `${profileId}-${index}`,
        type: 0,
        api: `https://example.test/${profileId}/${index}`,
      } as SourceBean)),
    ]));

    let active = 0;
    let peak = 0;
    const startedProfiles = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const releaseTimer = setTimeout(release, 100);
    const fakeHost = Object.assign(Object.create(SpiderHost.prototype), {
      manager: {
        rawProfiles: () => profiles,
        activeProfileId: () => profileIds[0],
        activeSourceKey: () => '',
      },
      profileExecutionConfig: (profileId: string) => ({ profileId, config: null }),
      searchableSites: (profileId: string) => sitesByProfile.get(profileId) ?? [],
      searchCache: {
        getEntry: () => undefined,
        delete: () => undefined,
        set: () => undefined,
      },
      sourceHealth: new Map(),
      unsupportedSources: new Set(),
      logger: { i: () => undefined, w: () => undefined },
      vm: {
        search: async (bean: SourceBean) => {
          active++;
          peak = Math.max(peak, active);
          const profileId = profileIds.find((id) => bean.key.startsWith(`${id}-`));
          if (profileId) startedProfiles.add(profileId);
          if (active === 24) release();
          await gate;
          active--;
          return [];
        },
      },
    }) as SpiderHost;

    try {
      await fakeHost.searchAll('test', { profileIds });
    } finally {
      clearTimeout(releaseTimer);
    }

    expect(peak).toBe(24);
    expect(startedProfiles).toEqual(new Set(profileIds));
  });
});
