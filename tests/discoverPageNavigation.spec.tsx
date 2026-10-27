// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { DiscoverItem } from '../src/shared/types';
import DiscoverPage from '../src/renderer/pages/DiscoverPage';

const movie = vi.hoisted((): DiscoverItem => ({
  title: '同一部影片', year: 2024, poster: 'https://images.example/poster.jpg',
  mediaType: 'movie', doubanId: 'douban-42', tmdbId: 4242, rating: 8.6,
}));

vi.mock('../src/renderer/lib/keepAlive', () => ({ usePageActive: () => true }));
vi.mock('../src/renderer/features/display/adapters/posterSizePreferenceAdapter', () => ({
  usePosterSizePreference: () => ({ size: 'medium', changeSize: vi.fn() }),
}));
vi.mock('../src/renderer/features/theme/adapters/useThemeStore', () => ({
  useTheme: () => 'default',
  useSkinLayout: () => ({ filterStyle: 'plain' }),
}));
vi.mock('../src/renderer/lib/presentationRegistry', () => ({
  discoverPresentationView: () => ({
    mode: 'poster-wall',
    wall: { containerClass: 'wall', chipListClass: 'chips', chipClass: 'chip', gridClass: 'grid' },
    card: { yearBadge: true, yearBadgeClass: 'year' },
    row: {},
  }),
}));
vi.mock('../src/renderer/features/covers/useCovers', () => ({
  useCovers: () => ({ picOf: (item: { pic: string }) => item.pic, onError: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../src/renderer/features/discovery/useDiscoverController', () => ({
  useDiscoverController: () => ({
    sections: [{ id: 'featured', title: '精选', items: [movie], mediaType: 'movie' }],
    err: '', loading: false, retry: vi.fn(),
  }),
}));
vi.mock('../src/renderer/features/discovery/useDiscoverExplore', () => ({
  useDiscoverExplore: () => ({
    media: null, mediaOpt: null, items: [], hasMore: false, loading: false,
    error: '', errorPhase: 'initial', levels: [{ options: [] }], loadMore: vi.fn(),
    retryPage: vi.fn(), refreshPage: vi.fn(), onPick: vi.fn(),
  }),
}));
vi.mock('../src/renderer/components/PosterSizeControl', () => ({ default: () => null }));
vi.mock('../src/renderer/components/PluginSlot', () => ({ default: () => null }));
vi.mock('../src/renderer/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('../src/renderer/components/ui/Tabs', () => ({ Tabs: () => null }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

afterEach(() => cleanup());

describe('DiscoverPage movie-card navigation', () => {
  it('opens the detail route with metadata from the clicked movie card', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<DiscoverPage />} />
          <Route path="/movie" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', {
      name: '同一部影片 (2024)，评分 8.6，查看详情与片源',
    }));

    const location = await screen.findByTestId('location');
    const [path, search = ''] = (location.textContent || '').split('?');
    const query = new URLSearchParams(search);
    expect(path).toBe('/movie');
    expect(query.get('name')).toBe(movie.title);
    expect(query.get('type')).toBe(movie.mediaType);
    expect(query.get('year')).toBe(String(movie.year));
    expect(query.get('pic')).toBe(movie.poster);
    expect(query.get('doubanId')).toBe(movie.doubanId);
    expect(query.get('tmdbId')).toBe(String(movie.tmdbId));
    expect(query.get('rating')).toBe(String(movie.rating));
  });
});
