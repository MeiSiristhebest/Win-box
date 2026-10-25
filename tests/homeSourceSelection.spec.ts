import { describe, expect, it } from 'vitest';
import { selectHomeSource, selectUsableHomeSource } from '../src/renderer/features/home/application/homeSourceSelection';
import type { SourceBean } from '../src/shared/types';

function source(key: string, type = 1): SourceBean {
  return { key, name: key, type, api: '', searchable: 1 } as SourceBean;
}

describe('home source selection policy', () => {
  it('restores a usable source remembered in the requested profile first', () => {
    const sources = [source('configured'), source('remembered')];

    expect(selectHomeSource({
      sources,
      profileId: 'profile-a',
      activeProfileId: 'profile-a',
      rememberedProfileId: 'profile-a',
      rememberedSourceKey: 'remembered',
      configuredSourceKey: 'configured',
    })).toBe('remembered');
  });

  it('ignores stale memory and unusable remembered/configured sources', () => {
    const sources = [source('unusable', 2), source('fallback'), source('configured')];

    expect(selectHomeSource({
      sources,
      profileId: 'profile-a',
      activeProfileId: 'profile-a',
      rememberedProfileId: 'profile-b',
      rememberedSourceKey: 'unusable',
      configuredSourceKey: 'configured',
    })).toBe('configured');

    expect(selectHomeSource({
      sources,
      profileId: 'profile-b',
      activeProfileId: 'profile-a',
      rememberedProfileId: 'profile-b',
      rememberedSourceKey: 'unusable',
      configuredSourceKey: 'configured',
    })).toBe('fallback');
  });

  it('prefers a usable requested source and falls back to the first usable source', () => {
    const sources = [source('unusable', 2), source('usable'), source('later')];

    expect(selectUsableHomeSource(sources, 'later')?.key).toBe('later');
    expect(selectUsableHomeSource(sources, 'missing')?.key).toBe('usable');
  });

  it('keeps the first source as a final fallback when none are usable', () => {
    expect(selectUsableHomeSource([source('first', 2), source('second', -1)])?.key).toBe('first');
    expect(selectUsableHomeSource([])).toBeUndefined();
  });
});
