// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { client } from '../src/renderer/api/client';
import { useHomeBrowseController } from '../src/renderer/features/home/useHomeBrowseController';
import type { VodItem } from '../src/shared/types';

vi.mock('../src/renderer/api/client', () => ({
  client: {
    home: vi.fn(),
    category: vi.fn(),
    cfgSetActiveSource: vi.fn(),
  },
}));

vi.mock('../src/renderer/lib/uiPrefs', () => ({
  useWaterfall: () => false,
  setWaterfall: vi.fn(),
}));

vi.mock('../src/renderer/lib/sessionSort', () => ({
  getSessionSort: vi.fn(),
  setSessionSort: vi.fn(),
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

function useBrowseHarness() {
  const [key, setKey] = React.useState('source-a');
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState('');
  const keyRef = React.useRef(key);
  const profileIdRef = React.useRef('profile-a');
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const controller = useHomeBrowseController({
    key,
    setKey,
    keyRef,
    profileIdRef,
    contentRef,
    loading,
    aggMode: false,
    setLoading,
    setErr,
    onBrowseStart: vi.fn(),
  });
  return { ...controller, key, keyRef, loading, err };
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
    act(() => result.current.chooseSource('source-b'));

    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['new item']));
    expect(result.current.key).toBe('source-b');
    expect(result.current.loading).toBe(false);

    await act(async () => {
      oldRequest.resolve(homeResult('stale item', 'source-a'));
      await oldRequest.promise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual(['new item']);
    expect(result.current.err).toBe('');
    expect(result.current.loading).toBe(false);
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
    act(() => result.current.chooseSource('source-b'));
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['current item']));

    await act(async () => {
      oldRequest.reject(new Error('stale failure'));
      await oldRequest.promise.catch(() => undefined);
    });

    expect(result.current.items.map((item) => item.id)).toEqual(['current item']);
    expect(result.current.err).toBe('');
    expect(result.current.loading).toBe(false);
  });
});
