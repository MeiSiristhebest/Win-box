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
  const [browseLoading, setBrowseLoading] = React.useState(false);
  const [err, setErr] = React.useState('');
  const keyRef = React.useRef(key);
  const profileIdRef = React.useRef('profile-a');
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const controller = useHomeBrowseController({
    data: {
      home: (sourceKey, profileId) => client.home(sourceKey, profileId),
      category: (request) => client.category(request),
    },
    key,
    setKey,
    keyRef,
    profileIdRef,
    contentRef,
    browseLoading,
    aggMode: false,
    waterfall: false,
    waterfallObserver: { observe: () => () => undefined },
    categoryState,
    setBrowseLoading,
    setBrowseError: setErr,
    onBrowseStart: vi.fn(),
  });
  return { ...controller, key, setKey, keyRef, browseLoading, err, categoryState };
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
    });

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
    });
  });
});
