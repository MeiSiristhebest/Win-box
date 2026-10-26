// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import { useHomeSearchController } from '../src/renderer/features/home/useHomeSearchController';
import { rendererSearchClock, rendererSearchFrames, rendererSearchWallClock } from '../src/renderer/features/home/adapters/rendererSearchClock';
import { initialHomeSearchViewState, reduceHomeSearchViewState } from '../src/renderer/features/home/application/homeSearchViewState';
import { saveUiMemory, uiMem } from '../src/renderer/lib/uiMemory';
import type { HomeSearchMem } from '../src/renderer/features/home/application/HomeSearchMemory';
import type { HomeBrowseSnapshot, HomeSearchBrowsePort } from '../src/renderer/features/home/application/homeBrowseSearchSession';
import type { HomeSortClassView } from '../src/renderer/features/home/application/homePorts';
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

vi.mock('../src/renderer/features/search/adapters/searchWindowNavigationAdapter', () => ({
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
  searchWindow = true,
  browseItems = [],
  browseReturnDestination,
  initialBrowseLoading = false,
  wallClock = rendererSearchWallClock,
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
  searchWindow?: boolean;
  browseItems?: VodItem[];
  browseReturnDestination?: ReturnType<HomeSearchBrowsePort['returnDestination']>;
  initialBrowseLoading?: boolean;
  wallClock?: { now(): number };
  profiles?: Array<{ id: string; name: string }>;
} = {}) {
  const [searchView, dispatchSearch] = React.useReducer(reduceHomeSearchViewState, {
    ...initialHomeSearchViewState,
    term: wd,
    searchAllSources,
    searchAllProfiles,
  });
  const [browseLoading, setBrowseLoading] = React.useState(initialBrowseLoading);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [items, setItems] = React.useState<VodItem[]>(browseItems);
  const [classes, setClasses] = React.useState<HomeSortClassView[]>([{ id: 'class-a', name: 'Class A' }]);
  const [pageInfo, setPageInfo] = React.useState({ page: 2, pagecount: 4, total: 16 });
  const [pg, setPg] = React.useState(2);
  const [tid, setTid] = React.useState('class-a');
  const [filtersActive, setFiltersActive] = React.useState<Record<string, string>>({ year: '2026' });
  const [fallback, setFallback] = React.useState(true);
  const [homeMemory, setHomeMemory] = React.useState({
    search: null as HomeSearchMem | null,
    profileId: 'profile-a',
    updatedAt: 0,
  });
  const [setSearchParams] = React.useState(() => vi.fn());
  const [openSearchWindow] = React.useState(() => vi.fn(async () => undefined));
  const [loadHome] = React.useState(() => vi.fn());
  const profileIdRef = React.useRef('profile-a');
  const keyRef = React.useRef('source-a');
  const browseSession: HomeSearchBrowsePort = {
    activeProfileId: () => profileIdRef.current,
    setActiveProfileId: (profileId) => { profileIdRef.current = profileId; },
    activeSourceKey: () => keyRef.current,
    invalidateBrowseRequests: () => undefined,
    preserveBrowseForSearch: vi.fn(),
    returnDestination: vi.fn(() => browseReturnDestination ?? { kind: 'reload' as const, sourceKey: keyRef.current }),
  };
  const sites = [{ key: 'source-a', name: 'Source A' } as SourceBean];
  const controller = useHomeSearchController({
    api: {
      onSearchAllProgress: (listener) => client.onSearchAllProgress(listener),
      searchAll: (term, options, signal) => client.searchAll(term, options, signal),
      search: (request, signal) => client.search(request, signal),
      category: (request) => client.category(request),
    },
    runtime: {
      aggregateClock: rendererSearchClock,
      wallClock,
      frames: rendererSearchFrames,
    },
    memory: {
      update: (patch) => setHomeMemory((current) => ({ ...current, ...patch })),
    },
    route: {
      pathname,
      navigation: {
        isSearchWindow: () => searchWindow,
        openSearchWindow,
        replaceSearchParameters: (parameters) => setSearchParams(parameters, { replace: true }),
        readRememberedSearch: () => uiMem.home.search ?? null,
        readHomeScrollTop: () => uiMem.home.scrollTop,
        persistUiMemory: () => saveUiMemory(),
      },
      requestedProfileId,
      aggParam,
      requestedAllProfiles,
      profileReady,
    },
    search: {
      ...searchView,
      profiles,
      sites,
    },
    browse: browseSession,
    actions: {
      dispatchSearch,
      setSearchLoading,
      setSearchError: setErr,
      clearBrowseLoading: () => setBrowseLoading(false),
      clearBrowseResults: () => setItems([]),
      restoreBrowse: (snapshot) => {
        setErr('');
        setItems(snapshot.items);
        setClasses(snapshot.classes);
        setPageInfo(snapshot.pageInfo);
        setPg(snapshot.pg);
        setTid(snapshot.tid);
        setFiltersActive(snapshot.filters);
        setFallback(snapshot.fallback);
      },
      loadHome,
    },
  });
  return {
    ...controller,
    homeMemory,
    wd: searchView.term,
    setWd: (term: string) => dispatchSearch({ type: 'term-changed', term }),
    loading: searchLoading,
    browseLoading,
    setBrowseLoading,
    err,
    agg: searchView.report,
    aggScope: searchView.scope,
    aggProgress: searchView.progress,
    allSources: searchView.searchAllSources,
    allProfiles: searchView.searchAllProfiles,
    profileIdRef,
    keyRef,
    browseSession,
    setSearchParams,
    openSearchWindow,
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
  it('aborts the previous search signal when a newer query takes ownership', async () => {
    const first = deferred<SearchAllReport>();
    const second = deferred<SearchAllReport>();
    const signals: AbortSignal[] = [];
    vi.mocked(client.searchAll).mockImplementation((term, _options, signal) => {
      if (signal) signals.push(signal);
      return term === 'first' ? first.promise : second.promise;
    });
    const { result, unmount } = renderHook(() => useSearchHarness({ wd: 'first', searchAllSources: true }));
    let firstSearch!: Promise<void>;
    let secondSearch!: Promise<void>;
    try {
      act(() => { firstSearch = result.current.doSearch(true, 'first', true); });
      await waitFor(() => expect(client.searchAll).toHaveBeenCalledTimes(1));
      act(() => { secondSearch = result.current.doSearch(true, 'second', true); });
      await waitFor(() => expect(client.searchAll).toHaveBeenCalledTimes(2));

      expect(signals).toHaveLength(2);
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);

      first.resolve(emptyReport());
      second.resolve(emptyReport());
      await act(async () => { await Promise.all([firstSearch, secondSearch]); });
    } finally {
      unmount();
    }
  });

  it('aborts an in-flight request and releases loading when the query is cleared', async () => {
    const request = deferred<SearchAllReport>();
    let signal!: AbortSignal;
    vi.mocked(client.searchAll).mockImplementationOnce((_term, _options, requestSignal) => {
      signal = requestSignal!;
      return request.promise;
    });
    const { result, unmount } = renderHook(() => useSearchHarness({ wd: 'first', searchAllSources: true }));
    let search!: Promise<void>;
    try {
      act(() => { search = result.current.doSearch(true, 'first', true); });
      await waitFor(() => expect(client.searchAll).toHaveBeenCalledOnce());
      expect(result.current.loading).toBe(true);

      act(() => { void result.current.doSearch(true, '', true); });

      expect(signal.aborted).toBe(true);
      expect(result.current.loading).toBe(false);
      request.resolve(emptyReport());
      await act(async () => { await search; });
    } finally {
      unmount();
    }
  });

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
      }, expect.any(AbortSignal));
    });
    expect(result.current.wd).toBe('route title');
    expect(result.current.allSources).toBe(true);
    expect(result.current.allProfiles).toBe(true);
    expect(result.current.aggScope).toBe('all-profiles');
  });

  it('keeps search loading owned by search when it supersedes an in-flight browse', async () => {
    const request = deferred<SearchAllReport>();
    vi.mocked(client.searchAll).mockReturnValueOnce(request.promise);
    const { result } = renderHook(() => useSearchHarness({
      wd: 'show',
      searchAllSources: true,
      initialBrowseLoading: true,
    }));
    let search!: Promise<void>;

    act(() => { search = result.current.doSearch(true); });

    expect(result.current.browseLoading).toBe(false);
    expect(result.current.loading).toBe(true);

    // A late browse finally block must not release the loading state of this search.
    act(() => result.current.setBrowseLoading(false));
    expect(result.current.loading).toBe(true);

    await act(async () => {
      request.resolve(emptyReport());
      await search;
    });
    expect(result.current.loading).toBe(false);
  });

  it('clears loading when route cleanup cancels an in-flight aggregate search', async () => {
    const request = deferred<SearchAllReport>();
    vi.mocked(client.searchAll).mockReturnValueOnce(request.promise);
    const { result, rerender } = renderHook(
      ({ aggParam }) => useSearchHarness({ wd: '', aggParam, profileReady: true, requestedAllProfiles: true }),
      { initialProps: { aggParam: 'route title' } },
    );

    await waitFor(() => expect(client.searchAll).toHaveBeenCalledWith('route title', {
      refresh: false,
      profileIds: ['profile-a', 'profile-b'],
    }, expect.any(AbortSignal)));
    expect(result.current.loading).toBe(true);

    rerender({ aggParam: '' });
    expect(result.current.loading).toBe(false);
    expect(result.current.err).toBe('');

    await act(async () => {
      request.resolve(emptyReport());
      await request.promise;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.agg).toBeNull();
  });

  it('delegates search-window navigation through the injected port', async () => {
    const { result } = renderHook(() => useSearchHarness({
      wd: 'show',
      pathname: '/',
      searchWindow: false,
    }));

    await act(async () => { await result.current.doSearch(); });

    expect(result.current.openSearchWindow).toHaveBeenCalledWith('show', 'profile-a', false);
    expect(client.search).not.toHaveBeenCalled();
    expect(client.searchAll).not.toHaveBeenCalled();
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
    expect(client.search).toHaveBeenNthCalledWith(1, { key: 'source-a', wd: 'first', profileId: 'profile-a' }, expect.any(AbortSignal));
    expect(client.search).toHaveBeenNthCalledWith(2, { key: 'source-a', wd: 'second', profileId: 'profile-a' }, expect.any(AbortSignal));

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
    }, expect.any(AbortSignal));
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

  it('persists and clears search memory through the application memory port', () => {
    let now = 100;
    const { result } = renderHook(() => useSearchHarness({ wallClock: { now: () => now++ } }));

    act(() => result.current.saveSearchMem('space show', emptyReport(), 'all', true, 'profile-a', true));

    expect(result.current.homeMemory).toMatchObject({
      profileId: 'profile-a',
      updatedAt: 100,
      search: {
        wd: 'space show',
        profileId: 'profile-a',
        aggMode: true,
        aggScope: 'all',
        searchAllSources: true,
        searchAllProfiles: true,
      },
    });

    act(() => result.current.clearSearchMemory());
    expect(result.current.homeMemory).toMatchObject({ profileId: 'profile-a', updatedAt: 101, search: null });

    act(() => result.current.exitSearch());
    expect(result.current.homeMemory).toMatchObject({ profileId: 'profile-a', updatedAt: 102, search: null });
  });

  it('cancels an in-flight aggregate search when browsing starts', async () => {
    const request = deferred<SearchAllReport>();
    vi.mocked(client.searchAll).mockReturnValueOnce(request.promise);
    const { result } = renderHook(() => useSearchHarness({ searchAllSources: true }));

    let search!: Promise<void>;
    await act(async () => {
      search = result.current.doSearch();
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);

    act(() => result.current.browseStarted());
    expect(result.current.loading).toBe(false);
    expect(result.current.agg).toBeNull();
    expect(result.current.homeMemory.search).toBeNull();

    request.resolve(emptyReport());
    await act(async () => { await search; });
    expect(result.current.agg).toBeNull();
  });

  it('restores the browse snapshot when exiting search', async () => {
    const browseItem = { id: 'browse-item', name: 'Browse item' } as unknown as VodItem;
    const snapshot: HomeBrowseSnapshot = {
      key: 'source-a',
      items: [browseItem],
      classes: [{ id: 'class-a', name: 'Class A' }],
      pageInfo: { page: 2, pagecount: 4, total: 16 },
      pg: 2,
      tid: 'class-a',
      filters: { year: '2026' },
      fallback: true,
    };
    const { result } = renderHook(() => useSearchHarness({
      browseItems: [browseItem],
      browseReturnDestination: { kind: 'restore', snapshot },
    }));

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

  it('clears search loading when exiting cancels an in-flight request', async () => {
    const request = deferred<VodItem[]>();
    vi.mocked(client.search).mockReturnValueOnce(request.promise);
    const browseItem = { id: 'browse-item', name: 'Browse item' } as unknown as VodItem;
    const snapshot: HomeBrowseSnapshot = {
      key: 'source-a',
      items: [browseItem],
      classes: [{ id: 'class-a', name: 'Class A' }],
      pageInfo: { page: 2, pagecount: 4, total: 16 },
      pg: 2,
      tid: 'class-a',
      filters: { year: '2026' },
      fallback: true,
    };
    const { result } = renderHook(() => useSearchHarness({
      browseItems: [browseItem],
      browseReturnDestination: { kind: 'restore', snapshot },
    }));
    let pending!: Promise<void>;

    act(() => { pending = result.current.doSearch(true); });
    expect(result.current.loading).toBe(true);

    act(() => result.current.exitSearch());
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([browseItem]);

    await act(async () => {
      request.resolve([{ id: 'late-result', name: 'Late result' } as unknown as VodItem]);
      await pending;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.agg).toBeNull();
    expect(result.current.items).toEqual([browseItem]);
  });

  it('clears folder loading when returning to search cancels a pending folder request', async () => {
    const folderRequest = deferred<Awaited<ReturnType<typeof client.category>>>();
    vi.mocked(client.category).mockReturnValueOnce(folderRequest.promise);
    const { result } = renderHook(() => useSearchHarness({ wd: 'show', searchAllSources: true }));
    await act(async () => { await result.current.doSearch(true); });
    const previousReport = result.current.agg;
    let pending!: Promise<void>;

    act(() => { pending = result.current.openFolder('source-a', 'folder-a', 'Folder A'); });
    expect(result.current.loading).toBe(true);

    act(() => result.current.exitFolder());
    expect(result.current.loading).toBe(false);
    expect(result.current.folder).toBeNull();
    expect(result.current.agg).toBe(previousReport);

    await act(async () => {
      folderRequest.resolve(categoryResult([{ id: 'late-folder-item', name: 'Late item' } as unknown as VodItem]));
      await pending;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.folder).toBeNull();
    expect(result.current.agg).toBe(previousReport);
  });

  it('releases loading when a new search invalidates a pending request but has no selected source', async () => {
    const request = deferred<VodItem[]>();
    vi.mocked(client.search).mockReturnValueOnce(request.promise);
    const { result } = renderHook(() => useSearchHarness());
    let pending!: Promise<void>;

    act(() => { pending = result.current.doSearch(true); });
    expect(result.current.loading).toBe(true);

    result.current.keyRef.current = '';
    await act(async () => { await result.current.doSearch(true); });

    expect(result.current.loading).toBe(false);
    expect(result.current.err).toBe('当前未选中任何源，无法搜索');
    expect(result.current.agg).toBeNull();

    await act(async () => {
      request.resolve([{ id: 'late-result', name: 'Late result' } as unknown as VodItem]);
      await pending;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.agg).toBeNull();
  });
});
