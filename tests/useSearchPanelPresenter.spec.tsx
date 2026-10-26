// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MovieHotList } from '../src/shared/types';
import type { SearchPanelPorts } from '../src/renderer/features/search/application/searchPanel';
import { useSearchPanelPresenter } from '../src/renderer/features/search/useSearchPanelPresenter';

afterEach(cleanup);

function createPorts(openSearch: SearchPanelPorts['navigation']['openSearch'] = vi.fn().mockResolvedValue(undefined)) {
  return {
    recommendations: {
      loadHotList: vi.fn().mockResolvedValue({ source: 'baidu', items: [], fetchedAt: 0, stale: false } satisfies MovieHotList),
      suggest: vi.fn().mockResolvedValue([]),
    },
    history: {
      load: vi.fn(() => []),
      record: vi.fn((term: string) => [term]),
      remove: vi.fn((current: string[], term: string) => current.filter((item) => item !== term)),
      clear: vi.fn(),
    },
    navigation: { openSearch },
  } satisfies SearchPanelPorts;
}

describe('useSearchPanelPresenter search workflow', () => {
  it('keeps the normalized query available for retry when opening the search window fails', async () => {
    const openSearch = vi.fn().mockRejectedValue(new Error('window unavailable'));
    const ports = createPorts(openSearch);
    const { result } = renderHook(() => useSearchPanelPresenter(ports));

    act(() => result.current.show());
    act(() => result.current.changeQuery('  银河列车  '));
    await act(async () => {
      await expect(result.current.search('  银河列车  ')).rejects.toThrow('window unavailable');
    });

    expect(ports.history.record).toHaveBeenCalledWith('银河列车');
    expect(openSearch).toHaveBeenCalledWith('银河列车');
    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe('银河列车');
    expect(result.current.suggestionsLoading).toBe(true);
  });

  it('closes and clears the query after navigation succeeds', async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useSearchPanelPresenter(ports));

    act(() => result.current.show());
    act(() => result.current.changeQuery('  银河列车  '));
    await act(async () => { await result.current.search('  银河列车  '); });

    expect(ports.navigation.openSearch).toHaveBeenCalledWith('银河列车');
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe('');
  });
});
