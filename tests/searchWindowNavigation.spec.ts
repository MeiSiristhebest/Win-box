import { describe, expect, it } from 'vitest';
import { isSearchWindowHash, resolveSearchWindowNavigation } from '../src/renderer/features/search/application/searchWindowNavigation';

describe('search window navigation policy', () => {
  it('ignores blank terms after trimming', () => {
    expect(resolveSearchWindowNavigation({
      term: '  ',
      currentHash: '#/home',
      navigationMode: 'inline',
      hasInlineNavigator: true,
    })).toEqual({ type: 'ignore' });
  });

  it('keeps the search window scope and profile when its current route is replaced', () => {
    expect(resolveSearchWindowNavigation({
      term: '  夜色  ',
      currentHash: '#/search?sw=1&profileId=profile-a&profiles=current',
      navigationMode: 'window',
      hasInlineNavigator: false,
    })).toEqual({
      type: 'set-search-window-route',
      route: '/search?agg=%E5%A4%9C%E8%89%B2&sw=1&profileId=profile-a&profiles=current',
    });
  });

  it('navigates inline and removes the auxiliary-window marker', () => {
    expect(resolveSearchWindowNavigation({
      term: '红海',
      currentHash: '#/home',
      navigationMode: 'inline',
      hasInlineNavigator: true,
      profileId: 'profile-b',
      allProfiles: false,
    })).toEqual({
      type: 'navigate-inline',
      route: '/search?agg=%E7%BA%A2%E6%B5%B7&profileId=profile-b&profiles=current',
    });
  });

  it('opens a separate window from a detail window even when inline navigation is preferred', () => {
    expect(resolveSearchWindowNavigation({
      term: '演员',
      currentHash: '#/detail/key/id?dw=1',
      navigationMode: 'inline',
      hasInlineNavigator: true,
      profileId: 'profile-c',
    })).toEqual({
      type: 'open-search-window',
      term: '演员',
      profileId: 'profile-c',
      allProfiles: true,
    });
  });

  it('opens a separate window when no inline navigator is bound', () => {
    expect(resolveSearchWindowNavigation({
      term: '  演员  ',
      currentHash: '#/home',
      navigationMode: 'inline',
      hasInlineNavigator: false,
      allProfiles: false,
    })).toEqual({ type: 'open-search-window', term: '演员', allProfiles: false });
  });

  it('evaluates search-window identity from each current route', () => {
    expect(isSearchWindowHash('#/search?sw=1&agg=film')).toBe(true);
    expect(isSearchWindowHash('#/home')).toBe(false);
    expect(isSearchWindowHash('#/search?xsw=1')).toBe(false);
  });
});
