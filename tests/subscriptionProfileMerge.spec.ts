import { describe, expect, it } from 'vitest';
import type { SourceBean, UserProfile } from '../src/shared/types';
import {
  parseSubscriptionSourceOverrides,
  reconcileSubscriptionProfileRefresh,
} from '../src/main/store/subscriptionProfileMerge';

function source(key: string, name = key, api = `https://${key}.example/api`): SourceBean {
  return {
    key,
    name,
    type: 0,
    api,
    searchable: 1,
    quickSearch: 1,
    changeable: 1,
    filterable: 1,
    playUrl: '',
    ext: '',
    jar: '',
    playerType: -1,
    categories: [],
    timeout: 15,
    click: '',
    style: '',
    homePage: '',
  };
}

function snapshot(sites: SourceBean[]): string {
  return JSON.stringify({ sites });
}

function profile(overrides: Partial<UserProfile>): Pick<UserProfile, 'json' | 'upstreamJson' | 'sourceOverridesJson'> {
  return {
    json: overrides.json ?? '',
    ...(overrides.upstreamJson !== undefined ? { upstreamJson: overrides.upstreamJson } : {}),
    ...(overrides.sourceOverridesJson !== undefined ? { sourceOverridesJson: overrides.sourceOverridesJson } : {}),
  };
}

describe('subscription profile refresh reconciliation', () => {
  it('applies local edits, deletions, additions, and order while taking untouched upstream updates', () => {
    const baseline = [source('a', 'A'), source('b', 'B'), source('c', 'C')];
    const current = [source('a', 'Pinned A'), source('c', 'C'), source('local', 'Local source')];
    const previous = profile({
      json: snapshot(current),
      upstreamJson: snapshot(baseline),
    });
    const incoming = [
      source('new', 'New upstream source'),
      source('a', 'A from upstream', 'https://a.example/v2'),
      source('b', 'B from upstream'),
      source('c', 'C from upstream'),
    ];

    const result = reconcileSubscriptionProfileRefresh(incoming, previous);

    expect(result.sources.map((item) => item.key)).toEqual(['a', 'c', 'local', 'new']);
    expect(result.sources[0]).toMatchObject({ name: 'Pinned A', api: 'https://a.example/v2' });
    expect(result.sources.find((item) => item.key === 'c')?.name).toBe('C from upstream');
    expect(result.refreshDiff).toBeUndefined();
  });

  it('preserves a legacy profile on its first refresh and records the upstream differences', () => {
    const current = [source('a', 'My A', 'https://a.example/old'), source('legacy-only', 'Local source')];
    const incoming = [source('a', 'A from upstream', 'https://a.example/new'), source('fresh', 'Fresh source')];
    const result = reconcileSubscriptionProfileRefresh(incoming, profile({ json: snapshot(current) }));

    expect(result.sources.map((item) => item.key)).toEqual(['a', 'legacy-only']);
    expect(result.sources[0]).toMatchObject({ name: 'My A', api: 'https://a.example/old' });
    expect(result.pendingUpstreamJson).toBe(snapshot(incoming));
    expect(result.refreshDiff).toEqual({
      addedKeys: ['fresh'],
      removedKeys: ['legacy-only'],
      changed: [{ key: 'a', fields: ['name', 'api'] }],
    });

    expect(parseSubscriptionSourceOverrides(result.sourceOverridesJson)).toMatchObject({ version: 1 });
  });
});
