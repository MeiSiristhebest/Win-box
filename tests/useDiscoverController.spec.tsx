// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import { useDiscoverController } from '../src/renderer/features/discovery/useDiscoverController';
import type { DiscoverGenre, DiscoverGenrePage, DiscoverSection } from '../src/shared/types';

vi.mock('../src/renderer/api/client', () => ({
  client: {
    metaDiscover: vi.fn(),
    metaGenres: vi.fn(),
    metaGenrePage: vi.fn(),
  },
}));

const section: DiscoverSection = { id: 'popular', title: '热门', items: [] };
const genre: DiscoverGenre = { id: 878, name: '科幻' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.metaDiscover).mockResolvedValue([section]);
  vi.mocked(client.metaGenres).mockResolvedValue({ movie: [genre], tv: [] });
  vi.mocked(client.metaGenrePage).mockResolvedValue({ items: [], page: 1, totalPages: 1 });
});

describe('useDiscoverController', () => {
  it('loads recommendation sections and genre lists', async () => {
    const { result } = renderHook(() => useDiscoverController());

    await waitFor(() => expect(result.current.sections).toEqual([section]));
    await waitFor(() => expect(result.current.genres).toEqual({ movie: [genre], tv: [] }));
    expect(result.current.hasGenres).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('discards a genre response after the selected media changes', async () => {
    let resolveRequest!: (value: DiscoverGenrePage) => void;
    vi.mocked(client.metaGenrePage).mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    const { result } = renderHook(() => useDiscoverController());
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
