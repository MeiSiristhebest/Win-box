// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UserConfig } from '../src/shared/types';
import type { ConfigurationSnapshotPort } from '../src/renderer/features/settings/application/configurationPagePorts';
import { useConfigurationSnapshotSession } from '../src/renderer/features/settings/useConfigurationSnapshotSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function configuration(revision: string): UserConfig {
  return { revision } as unknown as UserConfig;
}

describe('useConfigurationSnapshotSession', () => {
  it('keeps the newest snapshot when an older refresh finishes later', async () => {
    const earlier = deferred<UserConfig>();
    const later = deferred<UserConfig>();
    const port: ConfigurationSnapshotPort = {
      load: vi.fn().mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise),
      announceSourcesChanged: vi.fn(),
    };
    const { result } = renderHook(() => useConfigurationSnapshotSession(port));
    let earlierRefresh!: Promise<void>;
    let laterRefresh!: Promise<void>;

    act(() => {
      earlierRefresh = result.current.refresh();
      laterRefresh = result.current.refresh();
    });

    await act(async () => {
      later.resolve(configuration('new'));
      await laterRefresh;
    });
    expect(result.current.configuration).toEqual(configuration('new'));
    expect(port.announceSourcesChanged).toHaveBeenCalledOnce();

    await act(async () => {
      earlier.resolve(configuration('old'));
      await earlierRefresh;
    });
    expect(result.current.configuration).toEqual(configuration('new'));
    expect(port.announceSourcesChanged).toHaveBeenCalledOnce();
  });

  it('does not surface a failure from a superseded refresh', async () => {
    const earlier = deferred<UserConfig>();
    const later = deferred<UserConfig>();
    const port: ConfigurationSnapshotPort = {
      load: vi.fn().mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise),
      announceSourcesChanged: vi.fn(),
    };
    const { result } = renderHook(() => useConfigurationSnapshotSession(port));
    let earlierRefresh!: Promise<void>;
    let laterRefresh!: Promise<void>;
    act(() => {
      earlierRefresh = result.current.refresh();
      laterRefresh = result.current.refresh();
    });

    await act(async () => {
      later.resolve(configuration('new'));
      await laterRefresh;
    });
    await act(async () => {
      earlier.reject(new Error('stale failure'));
      await earlierRefresh;
    });

    expect(result.current.configuration).toEqual(configuration('new'));
    expect(port.announceSourcesChanged).toHaveBeenCalledOnce();
  });

  it('does not commit or announce a snapshot after the session unmounts', async () => {
    const request = deferred<UserConfig>();
    const port: ConfigurationSnapshotPort = {
      load: vi.fn(() => request.promise),
      announceSourcesChanged: vi.fn(),
    };
    const { result, unmount } = renderHook(() => useConfigurationSnapshotSession(port));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    unmount();

    request.resolve(configuration('late'));
    await refresh;

    expect(port.announceSourcesChanged).not.toHaveBeenCalled();
  });
});
