import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/main/util/logger', () => ({
  fileLogger: { i: () => undefined, w: () => undefined, e: () => undefined },
}));
import { SpiderHost } from '../src/main/spider/SpiderHost';
import type { SourceBean } from '../src/shared/types';

function makeHost(
  profileIds: string[],
  sitesByProfile: Map<string, SourceBean[]>,
  vm: { search: (bean: SourceBean) => Promise<[]>; spiderFactory?: { getCSP: (bean: SourceBean) => unknown } },
): SpiderHost {
  const profiles = profileIds.map((id) => ({ id, name: id }));
  return Object.assign(Object.create(SpiderHost.prototype), {
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
    vm,
  }) as SpiderHost;
}

function profileSources(profileId: string, count: number, type = 0): SourceBean[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `${profileId}-${index}`,
    name: `${profileId}-${index}`,
    type,
    api: `https://example.test/${profileId}/${index}`,
  } as SourceBean));
}

describe('SpiderHost.searchAll across profiles', () => {
  it('keeps one shared 24-source cap while searching more than 24 sources across profiles', async () => {
    const profileIds = ['profile-a', 'profile-b', 'profile-c'];
    const sitesByProfile = new Map(profileIds.map((id) => [id, profileSources(id, 16)]));
    let active = 0;
    let peak = 0;
    let started = 0;
    const startedProfiles = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const releaseTimer = setTimeout(release, 1_000);
    const fakeHost = makeHost(profileIds, sitesByProfile, {
      search: async (bean) => {
        active++;
        started++;
        peak = Math.max(peak, active);
        const profileId = profileIds.find((id) => bean.key.startsWith(`${id}-`));
        if (profileId) startedProfiles.add(profileId);
        if (active === 24) release();
        try {
          await gate;
          return [];
        } finally {
          active--;
        }
      },
    });

    try {
      await fakeHost.searchAll('test', { profileIds });
    } finally {
      clearTimeout(releaseTimer);
    }

    expect(peak).toBe(24);
    expect(startedProfiles).toEqual(new Set(profileIds));
    expect(started).toBe(48);
  });

  it('reallocates idle profile capacity to a large profile', async () => {
    const profileIds = ['large-profile', 'small-profile-b', 'small-profile-c'];
    const sitesByProfile = new Map([
      ['large-profile', profileSources('large-profile', 120)],
      ['small-profile-b', profileSources('small-profile-b', 1)],
      ['small-profile-c', profileSources('small-profile-c', 1)],
    ]);
    let activeLarge = 0;
    let peakLarge = 0;
    let started = 0;
    const startedProfiles = new Set<string>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const releaseTimer = setTimeout(release, 1_000);
    const fakeHost = makeHost(profileIds, sitesByProfile, {
      search: async (bean) => {
        const profileId = profileIds.find((id) => bean.key.startsWith(`${id}-`));
        if (profileId) startedProfiles.add(profileId);
        started++;
        if (profileId !== 'large-profile') return [];
        activeLarge++;
        peakLarge = Math.max(peakLarge, activeLarge);
        if (activeLarge === 24) release();
        try {
          await gate;
          return [];
        } finally {
          activeLarge--;
        }
      },
    });

    try {
      await fakeHost.searchAll('test', { profileIds });
    } finally {
      clearTimeout(releaseTimer);
    }

    expect(peakLarge).toBe(24);
    expect(startedProfiles).toEqual(new Set(profileIds));
    expect(started).toBe(122);
  });

  it('stops queued profile work and waits for in-flight searches before propagating preparation failures', async () => {
    const profileIds = ['searching-profile', 'failing-profile'];
    const sitesByProfile = new Map([
      ['searching-profile', profileSources('searching-profile', 50)],
      ['failing-profile', profileSources('failing-profile', 1, 3)],
    ]);
    let active = 0;
    let started = 0;
    let preparationFinished = false;
    const fakeHost = makeHost(profileIds, sitesByProfile, {
      search: async () => {
        active++;
        started++;
        try {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return [];
        } finally {
          active--;
        }
      },
      spiderFactory: {
        getCSP: () => ({
          runtimeState: () => 'preparing',
          pendingRuntime: () => new Promise((_, reject) => setTimeout(() => {
            preparationFinished = true;
            reject(new Error('runtime preparation failed'));
          }, 30)),
          lastReason: '',
        }),
      },
    });

    await expect(fakeHost.searchAll('test', { profileIds })).rejects.toThrow('runtime preparation failed');
    const startedAtFailure = started;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(preparationFinished).toBe(true);
    expect(startedAtFailure).toBeGreaterThan(0);
    expect(startedAtFailure).toBeLessThan(50);
    expect(started).toBe(startedAtFailure);
    expect(active).toBe(0);
  });
});
