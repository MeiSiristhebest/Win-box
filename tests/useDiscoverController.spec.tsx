// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDiscoverController } from '../src/renderer/features/discovery/useDiscoverController';
import type { DiscoverGenre, DiscoverGenrePage, DiscoverSection } from '../src/shared/types';
import type { DiscoverLandingPort } from '../src/renderer/features/discovery/application/discoveryPorts';

const section: DiscoverSection = { id: 'popular', title: '热门', items: [] };
const genre: DiscoverGenre = { id: 878, name: '科幻' };
const port: DiscoverLandingPort = {
  loadSections: vi.fn(),
  loadGenres: vi.fn(),
  loadGenrePage: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(port.loadSections).mockResolvedValue([section]);
  vi.mocked(port.loadGenres).mockResolvedValue({ movie: [genre], tv: [] });
  vi.mocked(port.loadGenrePage).mockResolvedValue({ items: [], page: 1, totalPages: 1 });
});

describe('useDiscoverController', () => {
  it('loads recommendation sections and genre lists', async () => {
    const { result } = renderHook(() => useDiscoverController(port));

    await waitFor(() => expect(result.current.sections).toEqual([section]));
    await waitFor(() => expect(result.current.genres).toEqual({ movie: [genre], tv: [] }));
    expect(result.current.hasGenres).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('discards a genre response after the selected media changes', async () => {
    let resolveRequest!: (value: DiscoverGenrePage) => void;
    vi.mocked(port.loadGenrePage).mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    const { result } = renderHook(() => useDiscoverController(port));
    await waitFor(() => expect(result.current.genres.movie).toEqual([genre]));

    act(() => result.current.switchMedia('movie'));
    act(() => result.current.loadGenre(genre, 1));
    expect(result.current.gLoading).toBe(true);
    act(() => result.current.switchMedia('tv'));
    await act(async () => {
      resolveRequest({ items: [], page: 1, totalPages: 1 });
    });

    expect(result.current.media).toBe('tv');
    expect(result.current.gSel).toBeNull();
    expect(result.current.gItems).toEqual([]);
    expect(result.current.gLoading).toBe(false);
  });
});
