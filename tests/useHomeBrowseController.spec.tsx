// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { client } from '../src/renderer/api/client';
import { useHomeBrowseController } from '../src/renderer/features/home/useHomeBrowseController';
import type { HomeCategoryStateMemoryPort } from '../src/renderer/features/home/application/homePorts';
import type { VodItem } from '../src/shared/types';

vi.mock('../src/renderer/api/client', () => ({
  client: {
    home: vi.fn(),
    category: vi.fn(),
    cfgSetActiveSource: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function homeResult(id: string, sourceKey: string) {
  const item: VodItem = {
    id,
    name: id,
    pic: '',
    remarks: '',
    year: '',
    area: '',
    type: '',
    sourceKey,
  };
  return {
    sourceKey,
    sortClasses: [],
    items: [item],
    page: 1,
    pagecount: 1,
    total: 1,
  } as Awaited<ReturnType<typeof client.home>>;
}

function useBrowseHarness(categoryState: HomeCategoryStateMemoryPort = { read: () => undefined, save: () => undefined }) {
  const [key, setKey] = React.useState('source-a');
  const keyRef = React.useRef(key);
  const profileIdRef = React.useRef('profile-a');
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const selectSource = React.useCallback((sourceKey: string) => {
    keyRef.current = sourceKey;
    setKey(sourceKey);
  }, []);
  const controller = useHomeBrowseController({
    ports: {
      data: {
        home: (sourceKey, profileId, signal) => client.home(sourceKey, profileId, signal),
        category: (request, signal) => client.category(request, signal),
      },
      context: {
        activeSourceKey: () => keyRef.current,
        selectSource,
        activeProfileId: () => profileIdRef.current,
        setActiveProfileId: (profileId) => { profileIdRef.current = profileId; },
      },
      categoryState,
      browseStarted: vi.fn(),
      memoryRestoreStarted: vi.fn(),
    },
    contentRef,
    aggMode: false,
    waterfall: false,
    waterfallObserver: { observe: () => () => undefined },
  });
  return { ...controller, key, setKey: selectSource, keyRef, browseLoading: controller.loading, err: controller.error, categoryState };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.cfgSetActiveSource).mockResolvedValue(undefined);
});

describe('useHomeBrowseController', () => {
  it('ignores an older home response after switching sources', async () => {
    const oldRequest = deferred<Awaited<ReturnType<typeof client.home>>>();
    vi.mocked(client.home)
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(homeResult('new item', 'source-b'));

    const { result } = renderHook(() => useBrowseHarness());
    act(() => {
      void result.current.loadHome('source-a');
    });
    act(() => {
      result.current.setKey('source-b');
      void result.current.loadHome('source-b');
    });

    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['new item']));
    expect(result.current.key).toBe('source-b');
    expect(result.current.browseLoading).toBe(false);

    await act(async () => {
      oldRequest.resolve(homeResult('stale item', 'source-a'));
      await oldRequest.promise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual(['new item']);
    expect(result.current.err).toBe('');
    expect(result.current.browseLoading).toBe(false);
  });

  it('does not publish a stale home error after a newer request succeeds', async () => {
    const oldRequest = deferred<Awaited<ReturnType<typeof client.home>>>();
    vi.mocked(client.home)
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(homeResult('current item', 'source-b'));

    const { result } = renderHook(() => useBrowseHarness());
    act(() => {
      void result.current.loadHome('source-a');
    });
    act(() => {
      result.current.setKey('source-b');
      void result.current.loadHome('source-b');
    });
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['current item']));

    await act(async () => {
      oldRequest.reject(new Error('stale failure'));
      await oldRequest.promise.catch(() => undefined);
    });

    expect(result.current.items.map((item) => item.id)).toEqual(['current item']);
    expect(result.current.err).toBe('');
    expect(result.current.browseLoading).toBe(false);
  });

  it('does not let a stale category page replace results after a filter/page request supersedes it', async () => {
    const oldPage = deferred<Awaited<ReturnType<typeof client.category>>>();
    const categoryResult = (id: string, page: number) => ({
      sourceKey: 'source-a',
      sortClasses: [],
      items: [{ id, name: id, pic: '', remarks: '', year: '', area: '', type: '', sourceKey: 'source-a' }],
      page,
      pagecount: 4,
      total: 12,
    }) as Awaited<ReturnType<typeof client.category>>;
    vi.mocked(client.category)
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce(categoryResult('filtered page', 1));

    const { result } = renderHook(() => useBrowseHarness());
    act(() => { void result.current.loadCategory('genre', 3, { area: 'east' }); });
    act(() => { void result.current.loadCategory('genre', 1, { area: 'west' }); });
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['filtered page']));

    await act(async () => {
      oldPage.resolve(categoryResult('stale page', 3));
      await oldPage.promise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual(['filtered page']);
    expect(result.current.pageInfo.page).toBe(1);
    expect(result.current.browseLoading).toBe(false);
  });

  it('preserves and restores browse state through the search handoff port', async () => {
    vi.mocked(client.home).mockResolvedValue(homeResult('browse item', 'source-a'));
    const { result } = renderHook(() => useBrowseHarness());

    await act(async () => { await result.current.loadHome('source-a'); });
    act(() => result.current.searchBrowsePort.preserveBrowseForSearch(false));

    expect(result.current.searchBrowsePort.returnDestination()).toEqual({
      kind: 'restore',
      snapshot: expect.objectContaining({ key: 'source-a', items: [expect.objectContaining({ id: 'browse item' })] }),
    });
  });

  it('restores every browse field through the controller-owned snapshot command', () => {
    const { result } = renderHook(() => useBrowseHarness());
    const snapshot = {
      key: 'source-a',
      items: [homeResult('restored item', 'source-a').items[0]!],
      classes: [{ id: 'genre', name: 'Drama' }],
      pageInfo: { page: 2, pagecount: 4, total: 12 },
      pg: 2,
      tid: 'genre',
      filters: { area: 'east' },
      fallback: true,
    };

    act(() => {
      result.current.clearBrowse();
      result.current.restoreSnapshot(snapshot);
    });

    expect(result.current.key).toBe('source-a');
    expect(result.current.items.map((item) => item.id)).toEqual(['restored item']);
    expect(result.current.classes).toEqual([{ id: 'genre', name: 'Drama' }]);
    expect(result.current.pageInfo).toEqual({ page: 2, pagecount: 4, total: 12 });
    expect(result.current.pg).toBe(2);
    expect(result.current.tid).toBe('genre');
    expect(result.current.filtersActive).toEqual({ area: 'east' });
    expect(result.current.fallback).toBe(true);
  });

  it('drops an old search snapshot when browsing a different source starts', async () => {
    vi.mocked(client.home)
      .mockResolvedValueOnce(homeResult('browse item', 'source-a'))
      .mockResolvedValueOnce(homeResult('other source item', 'source-b'));
    const { result } = renderHook(() => useBrowseHarness());

    await act(async () => { await result.current.loadHome('source-a'); });
    act(() => result.current.searchBrowsePort.preserveBrowseForSearch(false));
    act(() => { result.current.setKey('source-b'); });
    await act(async () => { await result.current.loadHome('source-b'); });

    expect(result.current.searchBrowsePort.returnDestination()).toEqual({ kind: 'reload', sourceKey: 'source-b' });
  });

  it('restores and saves category state through the injected memory port', async () => {
    const remembered = { filters: { area: 'east' }, page: 3 };
    const categoryState: HomeCategoryStateMemoryPort = {
      read: vi.fn((_sourceKey, categoryId) => categoryId === 'genre' ? remembered : undefined),
      save: vi.fn(),
    };
    vi.mocked(client.category).mockResolvedValue({
      sourceKey: 'source-a', sortClasses: [], items: [], page: 3, pagecount: 4, total: 12,
    } as Awaited<ReturnType<typeof client.category>>);

    const { result } = renderHook(() => useBrowseHarness(categoryState));
    act(() => result.current.chooseCategory('genre'));

    await waitFor(() => expect(result.current.pg).toBe(3));
    expect(categoryState.read).toHaveBeenCalledWith('source-a', 'genre', 'profile-a');
    expect(client.category).toHaveBeenCalledWith({
      key: 'source-a', tid: 'genre', pg: '3', extend: { area: 'east' }, profileId: 'profile-a',
    }, expect.any(AbortSignal));

    act(() => result.current.chooseFilter('area', 'west'));
    expect(categoryState.save).toHaveBeenCalledWith('source-a', 'genre', 'profile-a', {
      filters: { area: 'west' }, page: 1,
    });
  });

  it('owns sanitized page jumps and clamps them to the active category', async () => {
    vi.mocked(client.category).mockResolvedValue({
      sourceKey: 'source-a', sortClasses: [], items: [], page: 1, pagecount: 4, total: 4,
    } as Awaited<ReturnType<typeof client.category>>);

    const { result } = renderHook(() => useBrowseHarness());
    act(() => result.current.chooseCategory('genre'));
    await waitFor(() => expect(result.current.browseLoading).toBe(false));

    act(() => result.current.changeJumpPage('page 9'));
    expect(result.current.jumpPage).toBe('9');
    act(() => result.current.jumpToPage());

    await waitFor(() => expect(result.current.pg).toBe(4));
    expect(client.category).toHaveBeenLastCalledWith({
      key: 'source-a', tid: 'genre', pg: '4', extend: {}, profileId: 'profile-a',
    }, expect.any(AbortSignal));
  });

  it('aborts the superseded network request when a new browse category starts', async () => {
    const pending = deferred<Awaited<ReturnType<typeof client.home>>>();
    vi.mocked(client.home).mockReturnValue(pending.promise);
    vi.mocked(client.category).mockResolvedValue({
      sourceKey: 'source-a', sortClasses: [], items: [], page: 1, pagecount: 1, total: 0,
    } as Awaited<ReturnType<typeof client.category>>);

    const { result } = renderHook(() => useBrowseHarness());
    act(() => { void result.current.loadHome('source-a'); });
    const oldSignal = vi.mocked(client.home).mock.calls[0]?.[2];
    expect(oldSignal?.aborted).toBe(false);

    act(() => { void result.current.loadCategory('genre', 1); });

    expect(oldSignal?.aborted).toBe(true);
    expect(vi.mocked(client.category).mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    pending.resolve(homeResult('ignored', 'source-a'));
  });
});
