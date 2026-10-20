// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import { useHomeSearchController } from '../src/renderer/features/home/useHomeSearchController';
import { makeStaleGuard } from '../src/renderer/lib/staleGuard';
import { uiMem, type HomeSearchMem } from '../src/renderer/lib/uiMemory';
import type { SortClassView } from '../src/renderer/features/home/useHomeBrowseController';
import type { SearchAllReport, SourceBean, VodItem } from '../src/shared/types';
import * as React from 'react';

vi.mock('../src/renderer/api/client', () => ({
  client: {
    search: vi.fn(),
    searchAll: vi.fn(),
    category: vi.fn(),
    onSearchAllProgress: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../src/renderer/lib/searchWin', () => ({
  isSearchWindow: () => true,
  openSearchWindow: vi.fn(),
}));

vi.mock('../src/renderer/lib/uiMemory', () => ({
  uiMem: { home: { scrollTop: 0, search: null } },
  saveUiMemory: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function emptyReport(): SearchAllReport {
  return {
    items: [],
    perSource: [],
    hitSources: 0,
    failedSources: 0,
    totalRaw: 0,
  };
}

function categoryResult(items: VodItem[] = []): Awaited<ReturnType<typeof client.category>> {
  return { items } as unknown as Awaited<ReturnType<typeof client.category>>;
}

function useSearchHarness({
  wd = 'first',
  searchAllSources = false,
  searchAllProfiles = false,
  aggParam = '',
  requestedAllProfiles = false,
  profileReady = false,
  requestedProfileId = 'profile-a',
  pathname = '/search',
  browseItems = [],
  profiles = [
    { id: 'profile-a', name: 'A' },
    { id: 'profile-b', name: 'B' },
  ],
}: {
  wd?: string;
  searchAllSources?: boolean;
  searchAllProfiles?: boolean;
  aggParam?: string;
  requestedAllProfiles?: boolean;
  profileReady?: boolean;
  requestedProfileId?: string;
  pathname?: string;
  browseItems?: VodItem[];
  profiles?: Array<{ id: string; name: string }>;
} = {}) {
  const [term, setTerm] = React.useState(wd);
  const [allSources, setAllSources] = React.useState(searchAllSources);
  const [allProfiles, setAllProfiles] = React.useState(searchAllProfiles);
  const [aggMode, setAggMode] = React.useState(false);
  const [aggScope, setAggScope] = React.useState<'current' | 'all' | 'all-profiles'>('current');
  const [agg, setAgg] = React.useState<SearchAllReport | null>(null);
  const [aggProgress, setAggProgress] = React.useState<{ done: number; total: number; pending: number } | null>(null);
  const [, setAggCap] = React.useState(60);
  const [aggSrc, setAggSrc] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [items, setItems] = React.useState<VodItem[]>(browseItems);
  const [classes, setClasses] = React.useState<SortClassView[]>([{ id: 'class-a', name: 'Class A' }]);
  const [pageInfo, setPageInfo] = React.useState({ page: 2, pagecount: 4, total: 16 });
  const [pg, setPg] = React.useState(2);
  const [tid, setTid] = React.useState('class-a');
  const [filtersActive, setFiltersActive] = React.useState<Record<string, string>>({ year: '2026' });
  const [fallback, setFallback] = React.useState(true);
  const [, setHomeSearch] = React.useState<HomeSearchMem | null>(null);
  const [setSearchParams] = React.useState(() => vi.fn());
  const [loadHome] = React.useState(() => vi.fn());
  const profileIdRef = React.useRef('profile-a');
  const keyRef = React.useRef('source-a');
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const listGen = React.useRef(makeStaleGuard());
  const searchGen = React.useRef(makeStaleGuard());
  const browseSnapRef = React.useRef<{
    key: string;
    items: VodItem[];
    classes: SortClassView[];
    pageInfo: { page: number; pagecount: number; total: number };
    pg: number;
    tid: string;
    filters: Record<string, string>;
    fallback: boolean;
  } | null>(null);
  const sites = [{ key: 'source-a', name: 'Source A' } as SourceBean];
  const controller = useHomeSearchController({
    pathname,
    setSearchParams,
    wd: term,
    setWd: setTerm,
    searchAllSources: allSources,
    setSearchAllSources: setAllSources,
    searchAllProfiles: allProfiles,
    setSearchAllProfiles: setAllProfiles,
    profiles,
    sites,
    profileIdRef,
    keyRef,
    requestedProfileId,
    aggParam,
    requestedAllProfiles,
    profileReady,
    aggMode,
    agg,
    aggScope,
    aggSrc,
    setAggMode,
    setAggScope,
    setAgg,
    setAggProgress,
    setAggCap,
    setAggSrc,
    setLoading,
    setErr,
    setItems,
    setClasses,
    setPageInfo,
    setPg,
    setTid,
    setFiltersActive,
    setFallback,
    loadHome,
    items,
    classes,
    pageInfo,
    pg,
    tid,
    filtersActive,
    fallback,
    contentRef,
    listGen,
    searchGen,
    browseSnapRef,
    setHomeSearch,
  });
  return {
    ...controller,
    wd: term,
    setWd: setTerm,
    loading,
    err,
    agg,
    aggScope,
    aggProgress,
    allSources,
    allProfiles,
    profileIdRef,
    setSearchParams,
    loadHome,
    items,
    classes,
    pageInfo,
    pg,
    tid,
    filtersActive,
    fallback,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  uiMem.home.search = null;
  vi.mocked(client.search).mockResolvedValue([]);
  vi.mocked(client.searchAll).mockResolvedValue(emptyReport());
  vi.mocked(client.category).mockResolvedValue(categoryResult());
});

describe('useHomeSearchController', () => {
  it('batches progress bursts and reuses cards from unchanged sources', async () => {
    vi.useFakeTimers();
    const request = deferred<SearchAllReport>();
    const off = vi.fn();
    let emit!: Parameters<typeof client.onSearchAllProgress>[0];
    vi.mocked(client.onSearchAllProgress).mockImplementationOnce(callback => { emit = callback; return off; });
    vi.mocked(client.searchAll).mockReturnValueOnce(request.promise);
    const { result, unmount } = renderHook(() => useSearchHarness({ wd: 'show', searchAllSources: true }));
    let search!: Promise<void>;
    try {
      act(() => { search = result.current.doSearch(true); });
      act(() => {
        emit({ wd: 'show', profileId: 'profile-a', done: 1, total: 3, source: { key: 'a', name: 'A', status: 'ok', items: [{ id: '1', name: 'One' } as VodItem] } });
        emit({ wd: 'show', profileId: 'profile-a', done: 2, total: 3 });
      });
      expect(result.current.agg).toBeNull();
      expect(result.current.aggProgress).toBeNull();
      act(() => { vi.advanceTimersByTime(200); });
      expect(result.current.aggProgress).toEqual({ done: 2, total: 3, pending: 1 });
      const first = result.current.agg!.items[0];
      act(() => {
        emit({ wd: 'show', profileId: 'profile-a', done: 3, total: 3, source: { key: 'b', name: 'B', status: 'empty', items: [] } });
        vi.advanceTimersByTime(200);
      });
      expect(result.current.agg!.items[0]).toBe(first);
      expect(result.current.agg!.perSource).toHaveLength(2);
      await act(async () => { request.resolve(result.current.agg!); await search; });
      expect(off).toHaveBeenCalledOnce();
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('waits for profile loading before executing a search route', async () => {
    const { result, rerender } = renderHook(
      ({ ready }) => useSearchHarness({
        wd: '',
        aggParam: 'route title',
        requestedAllProfiles: true,
        profileReady: ready,
      }),
      { initialProps: { ready: false } },
    );

    expect(client.searchAll).not.toHaveBeenCalled();
    rerender({ ready: true });

    await waitFor(() => {
      expect(client.searchAll).toHaveBeenCalledWith('route title', {
        refresh: false,
        profileIds: ['profile-a', 'profile-b'],
      });
    });
    expect(result.current.wd).toBe('route title');
    expect(result.current.allSources).toBe(true);
    expect(result.current.allProfiles).toBe(true);
    expect(result.current.aggScope).toBe('all-profiles');
  });

  it('restores a matching search route from memory without rerunning it', async () => {
    const report = emptyReport();
    uiMem.home.search = {
      wd: 'route title',
      profileId: 'profile-a',
      aggMode: true,
      aggScope: 'all-profiles',
      searchAllSources: true,
      searchAllProfiles: true,
      agg: report,
    };

    const { result } = renderHook(() => useSearchHarness({
      wd: '',
      aggParam: 'route title',
      requestedAllProfiles: true,
      profileReady: true,
    }));

    await waitFor(() => expect(result.current.wd).toBe('route title'));
    expect(result.current.agg).toBe(report);
    expect(result.current.aggScope).toBe('all-profiles');
    expect(client.searchAll).not.toHaveBeenCalled();
  });

  it('keeps the latest search loading while an older request resolves', async () => {
    const oldRequest = deferred<VodItem[]>();
    const currentRequest = deferred<VodItem[]>();
    vi.mocked(client.search)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);

    const { result } = renderHook(() => useSearchHarness());
    act(() => {
      void result.current.doSearch();
    });
    act(() => result.current.setWd('second'));
    act(() => {
      void result.current.doSearch();
    });

    expect(result.current.loading).toBe(true);
    expect(client.search).toHaveBeenNthCalledWith(1, { key: 'source-a', wd: 'first', profileId: 'profile-a' });
    expect(client.search).toHaveBeenNthCalledWith(2, { key: 'source-a', wd: 'second', profileId: 'profile-a' });

    await act(async () => {
      oldRequest.resolve([]);
      await oldRequest.promise;
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      currentRequest.resolve([]);
      await currentRequest.promise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.agg?.perSource[0]?.key).toBe('source-a');
  });

  it('searches the selected profiles without changing the active profile', async () => {
    const { result } = renderHook(() => useSearchHarness({
      wd: 'show',
      searchAllSources: true,
      searchAllProfiles: true,
    }));

    await act(async () => {
      await result.current.doSearch(true);
    });

    expect(client.searchAll).toHaveBeenCalledWith('show', {
      refresh: true,
      profileIds: ['profile-a', 'profile-b'],
    });
    expect(result.current.aggScope).toBe('all-profiles');
    expect(result.current.profileIdRef.current).toBe('profile-a');
  });

  it('opens a search folder and restores the previous result snapshot', async () => {
    const { result } = renderHook(() => useSearchHarness({
      wd: 'show',
      searchAllSources: true,
    }));
    const item = { id: 'share-1', name: 'Share' } as unknown as VodItem;

    await act(async () => { await result.current.doSearch(true); });
    const previousReport = result.current.agg;
    vi.mocked(client.category).mockResolvedValueOnce(categoryResult([item]));

    await act(async () => { await result.current.openFolder('source-a', 'cloud', 'Cloud'); });

    expect(client.category).toHaveBeenCalledWith({ key: 'source-a', tid: 'cloud', pg: '1', profileId: 'profile-a' });
    expect(result.current.folder).toEqual({ key: 'source-a', tid: 'cloud', name: 'Cloud', profileId: 'profile-a', sourceName: 'Source A' });
    expect(result.current.agg?.items[0]?.id).toBe('share-1');

    act(() => result.current.exitFolder());

    expect(result.current.folder).toBeNull();
    expect(result.current.agg).toBe(previousReport);
    expect(result.current.allSources).toBe(true);
    expect(client.searchAll).toHaveBeenCalledTimes(1);
  });

  it('ignores an older folder response without clearing the newer request loading state', async () => {
    const first = deferred<Awaited<ReturnType<typeof client.category>>>();
    const second = deferred<Awaited<ReturnType<typeof client.category>>>();
    vi.mocked(client.category).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSearchHarness());
    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    act(() => { firstRequest = result.current.openFolder('source-a', 'folder-a', 'Folder A'); });
    act(() => { secondRequest = result.current.openFolder('source-a', 'folder-b', 'Folder B'); });

    await act(async () => {
      first.resolve(categoryResult([{ id: 'old', name: 'Old' } as unknown as VodItem]));
      await first.promise;
    });
    expect(result.current.folder).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      second.resolve(categoryResult([{ id: 'new', name: 'New' } as unknown as VodItem]));
      await second.promise;
    });
    await Promise.all([firstRequest, secondRequest]);

    expect(result.current.folder?.tid).toBe('folder-b');
    expect(result.current.agg?.items[0]?.id).toBe('new');
    expect(result.current.loading).toBe(false);
  });

  it('writes and clears search parameters only on the search route', async () => {
    const { result } = renderHook(() => useSearchHarness());

    act(() => result.current.saveSearchMem('space show', emptyReport(), 'all', true, 'profile-a', true));

    expect(result.current.setSearchParams).toHaveBeenCalledWith(
      { agg: 'space show', profiles: 'all', sw: '1', profileId: 'profile-a' },
      { replace: true },
    );

    act(() => result.current.exitSearch());
    expect(result.current.setSearchParams).toHaveBeenLastCalledWith({}, { replace: true });
  });

  it('restores the browse snapshot when exiting search', async () => {
    const browseItem = { id: 'browse-item', name: 'Browse item' } as unknown as VodItem;
    const { result } = renderHook(() => useSearchHarness({ browseItems: [browseItem] }));

    await act(async () => { await result.current.doSearch(true); });
    expect(result.current.items).toEqual([]);
    act(() => result.current.exitSearch());

    expect(result.current.items).toEqual([browseItem]);
    expect(result.current.classes).toEqual([{ id: 'class-a', name: 'Class A' }]);
    expect(result.current.pageInfo).toEqual({ page: 2, pagecount: 4, total: 16 });
    expect(result.current.pg).toBe(2);
    expect(result.current.tid).toBe('class-a');
    expect(result.current.filtersActive).toEqual({ year: '2026' });
    expect(result.current.fallback).toBe(true);
    expect(result.current.loadHome).not.toHaveBeenCalled();
  });
});
