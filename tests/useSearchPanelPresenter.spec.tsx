// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetaSuggestion } from '../src/shared/meta';
import type { MovieHotList } from '../src/shared/types';
import type { SearchPanelPorts } from '../src/renderer/features/search/application/searchPanel';
import { useSearchPanelPresenter } from '../src/renderer/features/search/useSearchPanelPresenter';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function createPorts(openSearch: SearchPanelPorts['navigation']['openSearch'] = vi.fn().mockResolvedValue(undefined)): SearchPanelPorts {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
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

  it('ignores an older suggestion response after the query changes', async () => {
    vi.useFakeTimers();
    const older = deferred<MetaSuggestion[]>();
    const newer = deferred<MetaSuggestion[]>();
    const ports = createPorts();
    ports.recommendations.suggest = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { result } = renderHook(() => useSearchPanelPresenter(ports));

    act(() => result.current.show());
    act(() => result.current.changeQuery('旧片名'));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(ports.recommendations.suggest).toHaveBeenNthCalledWith(1, '旧片名');

    act(() => result.current.changeQuery('新片名'));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(ports.recommendations.suggest).toHaveBeenNthCalledWith(2, '新片名');

    await act(async () => { older.resolve([{ title: '旧结果', year: 2020, mediaType: 'movie' }]); });
    expect(result.current.suggestions).toEqual([]);
    await act(async () => { newer.resolve([{ title: '新结果', year: 2024, mediaType: 'tv' }]); });
    expect(result.current.suggestions).toEqual([{ title: '新结果', year: 2024, mediaType: 'tv' }]);

  });

  it('clears a pending suggestion debounce when the panel unmounts', async () => {
    vi.useFakeTimers();
    const ports = createPorts();
    const { result, unmount } = renderHook(() => useSearchPanelPresenter(ports));

    act(() => result.current.show());
    act(() => result.current.changeQuery('待搜索'));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(ports.recommendations.suggest).not.toHaveBeenCalled();
  });

  it('retries a failed hot list and applies history remove and clear through their ports', async () => {
    const ports = createPorts();
    ports.history.load = vi.fn(() => ['旧片名', '另一部']);
    ports.recommendations.loadHotList = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        source: 'baidu',
        items: [{ rank: 1, title: '新热搜', score: 99 }],
        fetchedAt: 1,
        stale: false,
      });
    const { result } = renderHook(() => useSearchPanelPresenter(ports));

    act(() => result.current.show());
    await waitFor(() => expect(result.current.hotLoading).toBe(false));
    expect(result.current.hotList).toBeNull();
    expect(result.current.history).toEqual(['旧片名', '另一部']);

    act(() => result.current.retryHotList());
    await waitFor(() => expect(result.current.hotList?.items[0]?.title).toBe('新热搜'));
    expect(ports.recommendations.loadHotList).toHaveBeenCalledTimes(2);

    act(() => result.current.removeHistory('旧片名'));
    expect(ports.history.remove).toHaveBeenCalledWith(['旧片名', '另一部'], '旧片名');
    expect(result.current.history).toEqual(['另一部']);
    act(() => result.current.clearHistory());
    expect(ports.history.clear).toHaveBeenCalledOnce();
    expect(result.current.history).toEqual([]);
  });
});
