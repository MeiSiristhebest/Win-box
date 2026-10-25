// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlayResult } from '../src/shared/types';
import type {
  PlayerInitData,
  PlayerPageEventsPort,
  PlayerPageHistoryPort,
  PlayerPageSessionPort,
  PlayerSourceMemoryPort,
} from '../src/renderer/features/playback/application/playerPageSession';
import { usePlayerPageSession } from '../src/renderer/features/playback/usePlayerPageSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function successfulPlay(url: string): PlayResult {
  return { parse: 0, url, playUrl: '', flag: 'line-a' };
}

describe('usePlayerPageSession', () => {
  it('ignores an older episode resolution and records only the latest successful selection', async () => {
    const firstResolution = deferred<PlayResult>();
    let initListener: ((data: PlayerInitData) => void) | null = null;
    let switchListener: ((index: number) => void) | null = null;
    const sessionPort: PlayerPageSessionPort = {
      play: vi.fn(({ id }) => id === 'episode-1'
        ? firstResolution.promise
        : Promise.resolve(successfulPlay('https://media.invalid/episode-2.mp4'))),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      onInit: ((listener) => {
        initListener = listener;
        return () => { if (initListener === listener) initListener = null; };
      }) satisfies PlayerPageEventsPort['onInit'],
      onEpisodeSwitch: (listener) => {
        switchListener = listener;
        return () => { if (switchListener === listener) switchListener = null; };
      },
      ready: vi.fn(async () => undefined),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const historyPort: PlayerPageHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      getPlaybackPosition: vi.fn(() => 0),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const init: PlayerInitData = {
      key: 'source-a',
      flag: 'line-a',
      episodes: [
        { name: '第01集', url: 'episode-1' },
        { name: '第02集', url: 'episode-2' },
      ],
      epIndex: 0,
      title: '测试影片',
      lastUrl: '',
      lastName: '',
      meta: { fromKey: 'source-a', sourceName: 'Source A', profileId: 'profile-a', vodId: 'vod-1' },
    };

    const { result, unmount } = renderHook(() => usePlayerPageSession(sessionPort, historyPort, sourceMemory));
    await waitFor(() => expect(initListener).toBeTypeOf('function'));
    act(() => initListener?.(init));
    await waitFor(() => expect(sessionPort.play).toHaveBeenCalledTimes(1));

    act(() => switchListener?.(1));
    await waitFor(() => expect(sessionPort.play).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.activeUrl).toBe('https://media.invalid/episode-2.mp4'));

    await act(async () => {
      firstResolution.resolve(successfulPlay('https://media.invalid/episode-1.mp4'));
      await firstResolution.promise;
    });

    expect(result.current.activeUrl).toBe('https://media.invalid/episode-2.mp4');
    expect(historyPort.recordHistory).toHaveBeenCalledTimes(1);
    expect(historyPort.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
      url: 'episode-2',
      remarks: '第02集',
      profileId: 'profile-a',
    }));

    unmount();
    expect(sessionPort.cleanupTemporaryFiles).toHaveBeenCalledOnce();
  });

  it('drops old episode state when a new init arrives and retries failed hydration from its input', async () => {
    const replacementSource = deferred<{ profileId: string; name: string }>();
    let holdReplacementSource = true;
    let initListener: ((data: PlayerInitData) => void) | null = null;
    const sessionPort: PlayerPageSessionPort = {
      play: vi.fn(async ({ id }) => successfulPlay(id === 'episode-new-1'
        ? 'https://media.invalid/new.mp4'
        : 'https://media.invalid/old.mp4')),
      resolveHistorySource: vi.fn(async ({ sourceKey }) => {
        if (sourceKey === 'source-new' && holdReplacementSource) {
          holdReplacementSource = false;
          return replacementSource.promise;
        }
        return { profileId: `profile-${sourceKey}`, name: `Source ${sourceKey}` };
      }),
      loadDetail: vi.fn(async () => null),
      onInit: (listener) => {
        initListener = listener;
        return () => { if (initListener === listener) initListener = null; };
      },
      onEpisodeSwitch: () => () => undefined,
      ready: vi.fn(async () => undefined),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const historyPort: PlayerPageHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      getPlaybackPosition: vi.fn(() => 0),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const createInit = (key: string, episodePrefix: string): PlayerInitData => ({
      key,
      flag: 'line-a',
      episodes: [
        { name: '第01集', url: `${episodePrefix}-1` },
        { name: '第02集', url: `${episodePrefix}-2` },
      ],
      epIndex: 0,
      title: `影片 ${key}`,
      lastUrl: '',
      lastName: '',
      meta: { fromKey: key, sourceName: `Source ${key}`, vodId: `vod-${key}` },
    });

    const { result, unmount } = renderHook(() => usePlayerPageSession(sessionPort, historyPort, sourceMemory));
    await waitFor(() => expect(initListener).toBeTypeOf('function'));
    act(() => initListener?.(createInit('source-old', 'episode-old')));
    await waitFor(() => expect(result.current.activeUrl).toBe('https://media.invalid/old.mp4'));

    act(() => initListener?.(createInit('source-new', 'episode-new')));
    await waitFor(() => expect(result.current.resolving).toBe(true));
    expect(result.current.init).toBeNull();
    expect(result.current.episodes).toEqual([]);

    await act(async () => {
      replacementSource.reject(new Error('新档案读取失败'));
      await replacementSource.promise.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.parseMsg).toBe('新档案读取失败'));
    expect(result.current.init).toBeNull();
    expect(sessionPort.play).toHaveBeenCalledTimes(1);

    act(() => result.current.retryCurrent());
    await waitFor(() => expect(result.current.activeUrl).toBe('https://media.invalid/new.mp4'));
    expect(sessionPort.resolveHistorySource).toHaveBeenCalledTimes(3);
    expect(sessionPort.play).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('autoChangeParse() 递增 parseOffset 轮转解析线路并保留播放秒数', async () => {
    let initListener: ((data: PlayerInitData) => void) | null = null;
    const playCalls: Array<{ id: string; parseOffset?: number }> = [];
    const sessionPort: PlayerPageSessionPort = {
      play: vi.fn(async (input) => {
        playCalls.push({ id: input.id, parseOffset: input.parseOffset });
        return {
          parse: 0,
          url: input.parseOffset === 1 ? 'https://media.invalid/stream-parse-2.m3u8' : 'https://media.invalid/stream-parse-1.m3u8',
          playUrl: '',
          flag: 'line-a',
          parseName: input.parseOffset === 1 ? '解析二线' : '解析一线',
        };
      }),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      onInit: ((listener) => {
        initListener = listener;
        return () => { if (initListener === listener) initListener = null; };
      }) satisfies PlayerPageEventsPort['onInit'],
      onEpisodeSwitch: vi.fn(() => () => undefined),
      ready: vi.fn(async () => undefined),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const historyPort: PlayerPageHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      getPlaybackPosition: vi.fn(() => 0),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const init: PlayerInitData = {
      key: 'source-a',
      flag: 'line-a',
      episodes: [{ name: '第01集', url: 'episode-1' }],
      epIndex: 0,
      title: '测试片',
      lastUrl: '',
      lastName: '',
    };

    const { result, unmount } = renderHook(() => usePlayerPageSession(sessionPort, historyPort, sourceMemory));
    await waitFor(() => expect(initListener).toBeTypeOf('function'));
    act(() => initListener?.(init));
    await waitFor(() => expect(result.current.activeUrl).toBe('https://media.invalid/stream-parse-1.m3u8'));
    expect(result.current.parseName).toBe('解析一线');
    expect(playCalls[0].parseOffset).toBeUndefined();

    // 触发自动切线，保留当前进度 125 秒
    await act(async () => {
      await result.current.autoChangeParse(125);
    });
    await waitFor(() => expect(result.current.activeUrl).toBe('https://media.invalid/stream-parse-2.m3u8'));
    expect(result.current.parseName).toBe('解析二线');
    expect(playCalls[1].parseOffset).toBe(1);
    expect(result.current.init?.startTime).toBe(125);

    unmount();
  });
});
