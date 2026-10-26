// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AggVodItem, VodItem } from '../src/shared/types';
import { aggregateHomeCoverItem, homeCoverItem, useHomePageCovers } from '../src/renderer/features/home/useHomePageCovers';
import { CoversProvider } from '../src/renderer/features/covers/CoverLookupContext';
import type { CoverLookupPort } from '../src/renderer/features/covers/application/coverLookupPort';

const coverMocks = vi.hoisted(() => ({
  resolveCover: vi.fn(async (_item: unknown) => 'https://images.example.test/enriched.jpg'),
}));

vi.mock('../src/renderer/lib/coverPick', () => ({
  resolveCover: coverMocks.resolveCover,
  preloadImage: vi.fn(async () => true),
}));

const lookup: CoverLookupPort = {
  loadSettings: vi.fn(async () => ({ key: 'tmdb', hasTmdb: true })),
  searchPoster: vi.fn(async () => 'https://images.example.test/enriched.jpg'),
};
const coverPorts = {
  lookup,
  settingsChanges: { subscribe: vi.fn(() => () => undefined) },
  images: { validate: vi.fn(async () => true), relay: (url: string) => url },
  clock: { now: () => Date.now() },
};
function wrapper({ children }: PropsWithChildren) {
  return <CoversProvider ports={coverPorts}>{children}</CoversProvider>;
}

function vod(overrides: Partial<VodItem> = {}): VodItem {
  return {
    id: 'film-1', name: '《星河》 第3集', pic: '', remarks: '2025年更新', year: '',
    area: '', type: '', sourceKey: 'source-1', ...overrides,
  };
}

beforeEach(() => {
  coverMocks.resolveCover.mockClear();
  vi.mocked(lookup.loadSettings).mockClear();
  vi.mocked(lookup.searchPoster).mockClear();
});
afterEach(cleanup);

describe('HomePage cover projection and loading', () => {
  it('normalizes the title and extracts a year for provider lookup', () => {
    expect(homeCoverItem(vod(), 'profile-source')).toEqual({
      id: 'profile-source\u0000film-1', name: '星河', year: '2025', pic: '',
    });
  });

  it('keeps aggregate cache identity scoped to the producing profile and source', () => {
    const item: AggVodItem = { ...vod({ sourceKey: 'shared-key' }), sourceRef: { profileId: 'profile-b', key: 'shared-key' } };
    const projected = aggregateHomeCoverItem(item, 'active-profile');
    expect(projected.id).toBe('["profile-b","shared-key"]\u0000film-1');
    expect(projected).toEqual(homeCoverItem(item, '["profile-b","shared-key"]'));
    expect(aggregateHomeCoverItem({ ...item, sourceRef: { profileId: 'profile-c', key: 'shared-key' } }, 'active-profile').id).not.toBe(projected.id);
    expect(aggregateHomeCoverItem({ ...item, sourceRef: undefined }, 'fallback-profile').id).toContain('["fallback-profile","shared-key"]');
  });

  it('only loads the visible failed aggregate poster and scopes its fallback request', async () => {
    const first: AggVodItem = {
      ...vod({ pic: 'https://source.example.test/poster.jpg', sourceKey: 'shared-key' }),
      sourceRef: { profileId: 'profile-b', key: 'shared-key' },
    };
    const later: AggVodItem = { ...vod({ id: 'film-2', sourceKey: 'other-key' }), sourceRef: { profileId: 'profile-c', key: 'other-key' } };
    const browseItem = vod({ id: 'browse-film', sourceKey: 'active-source' });
    const { result } = renderHook(() => useHomePageCovers({
      browseItems: [browseItem], searchItems: [first, later], sourceKey: 'active-source', profileId: 'active-profile',
      visibleSearchLimit: 1, active: true, loading: false, aggregateMode: true,
    }), { wrapper });

    await waitFor(() => expect(result.current.searchPicOf(first)).toBe(first.pic));
    expect(coverMocks.resolveCover).not.toHaveBeenCalled();

    act(() => result.current.onSearchImageError(first, first.pic));
    await waitFor(() => expect(coverMocks.resolveCover).toHaveBeenCalledTimes(1));
    expect(coverMocks.resolveCover).toHaveBeenCalledWith(expect.objectContaining({
      id: '["profile-b","shared-key"]\u0000film-1', name: '星河', year: '2025', pic: first.pic,
    }), expect.any(Object));
    await waitFor(() => expect(result.current.searchPicOf(first)).toBe('https://images.example.test/enriched.jpg'));
    expect(coverMocks.resolveCover.mock.calls[0]?.[0]).not.toMatchObject({ id: expect.stringContaining('film-2') });
  });

  it('loads browse covers only while the active browse view is settled', async () => {
    const item = vod({ pic: 'https://source.example.test/browse.jpg' });
    const { result, rerender } = renderHook(
      (props: { active: boolean; loading: boolean }) => useHomePageCovers({
        browseItems: [item], searchItems: [], sourceKey: 'active-source', profileId: 'profile-a',
        visibleSearchLimit: 20, active: props.active, loading: props.loading, aggregateMode: false,
      }),
      { initialProps: { active: false, loading: false }, wrapper },
    );
    expect(coverMocks.resolveCover).not.toHaveBeenCalled();

    rerender({ active: true, loading: true });
    expect(coverMocks.resolveCover).not.toHaveBeenCalled();
    rerender({ active: true, loading: false });
    await waitFor(() => expect(coverMocks.resolveCover).toHaveBeenCalledTimes(1));
    expect(coverMocks.resolveCover).toHaveBeenCalledWith(expect.objectContaining({
      id: 'active-source\u0000film-1', name: '星河', year: '2025', pic: item.pic,
    }), expect.any(Object));
    expect(result.current.picOf(item)).toBe('https://images.example.test/enriched.jpg');
  });
});
