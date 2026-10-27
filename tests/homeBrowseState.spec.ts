import { describe, expect, it, vi } from 'vitest';
import {
  createHomeBrowseSnapshot,
  INITIAL_HOME_BROWSE_STATE,
  reduceHomeBrowseState,
  rememberedHomeBrowseCategory,
  resolveHomeBrowseAdjacentPage,
  resolveHomeBrowseJumpPage,
  sanitizeHomeBrowsePageInput,
  toggleHomeBrowseFilter,
} from '../src/renderer/features/home/application/homeBrowseState';
import type { HomeCategoryResult } from '../src/renderer/features/home/application/homePorts';
import type { VodItem } from '../src/shared/types';

function result(ids: string[], page = 1, pagecount = 5): HomeCategoryResult {
  return {
    sortClasses: [{ id: 'genre', name: '剧情' }],
    items: ids.map((id) => ({ id, name: id, sourceKey: 'source-a' } as VodItem)),
    page,
    pagecount,
    total: pagecount * ids.length,
  };
}

describe('home browse application state', () => {
  it('restores filters and page from memory scoped to the active source and profile', () => {
    const read = vi.fn((sourceKey: string, categoryId: string, profileId: string) => {
      if (sourceKey !== 'source-a' || categoryId !== 'genre' || profileId !== 'profile-a') return undefined;
      return { filters: { area: 'east' }, page: 3 };
    });

    const restored = rememberedHomeBrowseCategory(read, 'source-a', 'genre', 'profile-a');
    const state = reduceHomeBrowseState(INITIAL_HOME_BROWSE_STATE, {
      type: 'category-selected',
      tid: 'genre',
      filters: restored.filters,
      page: restored.page,
    });

    expect(read).toHaveBeenCalledWith('source-a', 'genre', 'profile-a');
    expect(state).toMatchObject({ tid: 'genre', filtersActive: { area: 'east' }, pg: 3 });
    expect(rememberedHomeBrowseCategory(read, 'source-a', 'genre', 'profile-b')).toEqual({ filters: {}, page: 1 });
  });

  it('toggles only the selected filter and makes a filter change start at page one', () => {
    const active = { area: 'east', year: '2026' };
    const cleared = toggleHomeBrowseFilter(active, 'area', 'east');
    const changed = toggleHomeBrowseFilter(active, 'area', 'west');

    expect(cleared).toEqual({ year: '2026' });
    expect(changed).toEqual({ area: 'west', year: '2026' });
    expect(reduceHomeBrowseState({ ...INITIAL_HOME_BROWSE_STATE, pg: 4 }, { type: 'filters-changed', filters: changed }))
      .toMatchObject({ pg: 1, filtersActive: { area: 'west', year: '2026' } });
  });

  it('owns page sanitizing, clamped jumps, unbounded-source paging, and busy guards', () => {
    expect(sanitizeHomeBrowsePageInput('page 12-3')).toBe('123');
    expect(resolveHomeBrowseJumpPage('9', 2, 5, false)).toBe(5);
    expect(resolveHomeBrowseJumpPage('9', 2, 2147483647, false)).toBe(9);
    expect(resolveHomeBrowseJumpPage('2', 2, 5, false)).toBeNull();
    expect(resolveHomeBrowseJumpPage('4', 2, 5, true)).toBeNull();
    expect(resolveHomeBrowseAdjacentPage('previous', 1, 5, false)).toBeNull();
    expect(resolveHomeBrowseAdjacentPage('next', 5, 5, false)).toBeNull();
    expect(resolveHomeBrowseAdjacentPage('next', 5, 2147483647, false)).toBe(6);
    expect(resolveHomeBrowseAdjacentPage('next', 5, 2147483647, true)).toBeNull();
  });

  it('round trips category/filter/page and waterfall termination state through a search snapshot', () => {
    let state = reduceHomeBrowseState(INITIAL_HOME_BROWSE_STATE, { type: 'home-loaded', result: result(['a', 'b']), fallback: true });
    state = reduceHomeBrowseState(state, { type: 'category-selected', tid: 'genre', filters: { year: '2026' }, page: 2 });
    state = reduceHomeBrowseState(state, { type: 'category-loaded', result: result(['c', 'd'], 2), page: 2, append: false });
    state = reduceHomeBrowseState(state, { type: 'category-loaded', result: result(['c', 'd'], 3), page: 3, append: true });

    const snapshot = createHomeBrowseSnapshot('source-a', state);
    expect(snapshot).toMatchObject({
      tid: 'genre',
      filters: { year: '2026' },
      pg: 3,
      wfNoMore: true,
      lastPageSignature: '2|c|d',
    });

    const restored = reduceHomeBrowseState(INITIAL_HOME_BROWSE_STATE, { type: 'snapshot-restored', snapshot });
    expect(restored).toMatchObject({
      items: [{ id: 'c' }, { id: 'd' }],
      tid: 'genre',
      filtersActive: { year: '2026' },
      pg: 3,
      wfNoMore: true,
      lastPageSignature: '2|c|d',
      fallback: true,
    });
  });

  it('stops waterfall when a reordered duplicate page adds no new item IDs', () => {
    const firstPage = result(['first', 'second'], 1, 8);
    const duplicatePage = result(['second', 'first'], 2, 8);
    let state = reduceHomeBrowseState(INITIAL_HOME_BROWSE_STATE, {
      type: 'category-loaded', result: firstPage, page: 1, append: false,
    });

    state = reduceHomeBrowseState(state, {
      type: 'category-loaded', result: duplicatePage, page: 2, append: true,
    });

    expect(state.items.map((item) => item.id)).toEqual(['first', 'second']);
    expect(state.wfNoMore).toBe(true);
    expect(state.lastPageSignature).toBe('2|second|first');
  });

  it('stops waterfall when the source returns an empty page', () => {
    const firstPage = result(['first'], 1, 8);
    const emptyPage = result([], 2, 8);
    let state = reduceHomeBrowseState(INITIAL_HOME_BROWSE_STATE, {
      type: 'category-loaded', result: firstPage, page: 1, append: false,
    });

    state = reduceHomeBrowseState(state, {
      type: 'category-loaded', result: emptyPage, page: 2, append: true,
    });

    expect(state.items.map((item) => item.id)).toEqual(['first']);
    expect(state.wfNoMore).toBe(true);
  });
});
