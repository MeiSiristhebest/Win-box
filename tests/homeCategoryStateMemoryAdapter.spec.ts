import { beforeEach, describe, expect, it } from 'vitest';
import { clearSessionSort } from '../src/renderer/lib/sessionSort';
import { homeCategoryStateMemoryAdapter } from '../src/renderer/features/home/adapters/homeCategoryStateMemoryAdapter';

describe('homeCategoryStateMemoryAdapter', () => {
  beforeEach(() => clearSessionSort());

  it('copies category filters when saving and reading session state', () => {
    const state = { filters: { area: 'east' }, page: 3 };
    homeCategoryStateMemoryAdapter.save('source-a', 'genre', 'profile-a', state);
    state.filters.area = 'west';

    const restored = homeCategoryStateMemoryAdapter.read('source-a', 'genre', 'profile-a');
    expect(restored).toEqual({ filters: { area: 'east' }, page: 3 });
    expect(restored).not.toBeUndefined();

    if (restored) restored.filters.area = 'south';
    expect(homeCategoryStateMemoryAdapter.read('source-a', 'genre', 'profile-a'))
      .toEqual({ filters: { area: 'east' }, page: 3 });
  });

  it('scopes remembered filters by profile and source', () => {
    homeCategoryStateMemoryAdapter.save('source-a', 'genre', 'profile-a', { filters: { area: 'east' }, page: 2 });

    expect(homeCategoryStateMemoryAdapter.read('source-a', 'genre', 'profile-b')).toBeUndefined();
    expect(homeCategoryStateMemoryAdapter.read('source-b', 'genre', 'profile-a')).toBeUndefined();
  });
});
