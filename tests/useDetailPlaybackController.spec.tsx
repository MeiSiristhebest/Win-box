// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDetailPlaybackController } from '../src/renderer/features/detail/useDetailPlaybackController';
import type { DetailPlaybackPort } from '../src/renderer/features/detail/application/detailPlaybackPorts';
import { makeStaleGuard } from '../src/renderer/lib/staleGuard';
import type { PlayResult, VodDetail } from '../src/shared/types';
import * as React from 'react';

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

const playResult: PlayResult = {
  parse: 0,
  url: 'https://media.example/stream.m3u8',
  playUrl: '',
  flag: 'hls',
};

describe('useDetailPlaybackController', () => {
  it('ignores a playback response after the selected episode changes', async () => {
    const oldRequest = deferred<PlayResult>();
    const currentRequest = deferred<PlayResult>();
    const playbackPort: DetailPlaybackPort = {
      play: vi.fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(currentRequest.promise),
      rememberSelection: vi.fn(),
      persistSelection: vi.fn(),
    };
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
        playbackPort,
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
    expect(playbackPort.play).toHaveBeenNthCalledWith(1, {
      key: 'source-a',
      flag: 'hls',
      episodeUrl: 'episode-1',
      profileId: 'profile-a',
    });
    expect(playbackPort.play).toHaveBeenNthCalledWith(2, {
      key: 'source-a',
      flag: 'hls',
      episodeUrl: 'episode-2',
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
    expect(playbackPort.rememberSelection).toHaveBeenCalledWith('profile-a:source-a:show-id', {
      flag: 'hls', ep: 1, scrollTop: 0,
    });
    expect(playbackPort.persistSelection).toHaveBeenCalledOnce();
  });
});
