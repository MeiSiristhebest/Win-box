// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import { getNavMode } from '../src/renderer/lib/uiPrefs';
import {
  bindSearchNavigation,
  isSearchWindow,
  openSearchWindow,
} from '../src/renderer/features/search/adapters/searchWindowNavigationAdapter';

vi.mock('../src/renderer/api/client', () => ({ client: { winOpenSearch: vi.fn() } }));
vi.mock('../src/renderer/lib/uiPrefs', () => ({ getNavMode: vi.fn(() => 'inline') }));

afterEach(() => {
  bindSearchNavigation(null);
  window.location.hash = '#/home';
  vi.clearAllMocks();
});

describe('search window navigation adapter', () => {
  it('reads window identity from the current hash instead of a module-load snapshot', () => {
    window.location.hash = '#/search?sw=1&agg=film';
    expect(isSearchWindow()).toBe(true);
    window.location.hash = '#/home';
    expect(isSearchWindow()).toBe(false);
  });

  it('uses the bound router for inline search and avoids opening an auxiliary window', async () => {
    const navigate = vi.fn();
    bindSearchNavigation(navigate);
    vi.mocked(getNavMode).mockReturnValue('inline');

    await openSearchWindow(' film ', 'profile-a', false);

    expect(navigate).toHaveBeenCalledWith('/search?agg=film&profileId=profile-a&profiles=current');
    expect(client.winOpenSearch).not.toHaveBeenCalled();
  });

  it('updates the existing search window while preserving its current scope', async () => {
    window.location.hash = '#/search?sw=1&profileId=profile-b&profiles=current';

    await openSearchWindow('new film');

    expect(window.location.hash).toBe('#/search?agg=new%20film&sw=1&profileId=profile-b&profiles=current');
    expect(client.winOpenSearch).not.toHaveBeenCalled();
  });

  it('opens a new search window from a detail window even when inline mode is preferred', async () => {
    window.location.hash = '#/detail/source/id?dw=1';
    vi.mocked(getNavMode).mockReturnValue('inline');

    await openSearchWindow('actor', 'profile-c');

    expect(client.winOpenSearch).toHaveBeenCalledWith('actor', 'profile-c', true);
  });

  it('opens a new search window when window mode is selected', async () => {
    const navigate = vi.fn();
    bindSearchNavigation(navigate);
    vi.mocked(getNavMode).mockReturnValue('window');

    await openSearchWindow('film', 'profile-d', false);

    expect(client.winOpenSearch).toHaveBeenCalledWith('film', 'profile-d', false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
