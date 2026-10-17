// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import { useDetailPlaybackController } from '../src/renderer/features/detail/useDetailPlaybackController';
import { makeStaleGuard } from '../src/renderer/lib/staleGuard';
import type { VodDetail } from '../src/shared/types';
import * as React from 'react';

vi.mock('../src/renderer/api/client', () => ({
  client: {
    play: vi.fn(),
  },
}));

vi.mock('../src/renderer/lib/uiMemory', () => ({
  uiMem: { detail: { set: vi.fn() } },
  schedulePersist: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const detail: VodDetail = {
  id: 'show-id',
  name: 'Show',
  pic: 'poster',
  type: 'series',
  year: '',
  area: '',
  director: '',
  actor: '',
  des: '',
  remarks: '',
  flags: ['hls'],
  episodes: {
    hls: [
      { name: 'Episode 1', url: 'episode-1' },
      { name: 'Episode 2', url: 'episode-2' },
    ],
  },
};

const playResult = {
  parse: 0,
  url: 'https://media.example/stream.m3u8',
  playUrl: '',
  flag: 'hls',
} as Awaited<ReturnType<typeof client.play>>;

describe('useDetailPlaybackController', () => {
  it('ignores a playback response after the selected episode changes', async () => {
    const oldRequest = deferred<Awaited<ReturnType<typeof client.play>>>();
    const currentRequest = deferred<Awaited<ReturnType<typeof client.play>>>();
    vi.mocked(client.play)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);
    const onPlay = vi.fn();
    const onNeedDriveCookieBind = vi.fn();

    const { result } = renderHook(() => {
      const [ep, setEp] = React.useState(0);
      const [epPage, setEpPage] = React.useState(0);
      const [busy, setBusy] = React.useState(false);
      const [err, setErr] = React.useState('');
      const [flag, setFlag] = React.useState('hls');
      const contentRef = React.useRef<HTMLDivElement | null>(null);
      const playGenRef = React.useRef(makeStaleGuard());
      const controller = useDetailPlaybackController({
        key: 'source-a',
        id: 'show-id',
        profileId: 'profile-a',
        memKey: 'profile-a:source-a:show-id',
        detail,
        displayName: 'Show',
        flag,
        setFlag,
        ep,
        setEp,
        setEpPage,
        busy,
        setBusy,
        setErr,
        contentRef,
        playGenRef,
        onPlay,
        onNeedDriveCookieBind,
      });
      return { ...controller, ep, epPage, busy, err };
    });

    act(() => {
      void result.current.play(0);
    });
    act(() => result.current.chooseEp(1));
    act(() => {
      void result.current.play(1);
    });

    expect(result.current.busy).toBe(true);
    expect(client.play).toHaveBeenNthCalledWith(1, {
      key: 'source-a',
      flag: 'hls',
      id: 'episode-1',
      profileId: 'profile-a',
    });
    expect(client.play).toHaveBeenNthCalledWith(2, {
      key: 'source-a',
      flag: 'hls',
      id: 'episode-2',
      profileId: 'profile-a',
    });

    await act(async () => {
      oldRequest.resolve(playResult);
      await oldRequest.promise;
    });
    expect(onPlay).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(true);

    await act(async () => {
      currentRequest.resolve(playResult);
      await currentRequest.promise;
    });
    expect(onPlay).toHaveBeenCalledWith(
      playResult.url,
      expect.any(String),
      'source-a',
      'show-id',
      expect.objectContaining({ profileId: 'profile-a', epIndex: 1, flag: 'hls', vodId: 'show-id' }),
    );
    expect(result.current.busy).toBe(false);
  });
});
