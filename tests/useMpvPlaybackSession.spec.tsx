// @vitest-environment happy-dom
import { useRef, useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyMpvKernelState, type MpvKernelState, type MpvStartOptions, type MpvStateEvent } from '../src/shared/player';
import type { PlaybackSourceRef } from '../src/renderer/lib/playbackProgress';
import { getPlayTime } from '../src/renderer/lib/uiMemory';
import { useMpvPlaybackSession, type MpvPlaybackSessionClient } from '../src/renderer/features/playback/useMpvPlaybackSession';
import type { Kernel } from '../src/renderer/lib/kernel';

function state(overrides: Partial<MpvKernelState> = {}): MpvKernelState {
  return { ...emptyMpvKernelState(), ...overrides };
}

function makeClient() {
  const listeners: Array<(event: MpvStateEvent) => void> = [];
  const client: MpvPlaybackSessionClient = {
    mpvOnState: (callback) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    mpvStart: vi.fn(async (_options: MpvStartOptions) => ({ session: 7 })),
    mpvCmd: vi.fn(async () => undefined),
    mpvStop: vi.fn(async () => undefined),
  };
  return { client, listeners };
}

function Harness({
  client,
  startTime = 45,
  onEnded = () => undefined,
  kernel = 'mpv',
  spdif,
  onEngineFailure,
}: {
  client: MpvPlaybackSessionClient;
  startTime?: number;
  onEnded?: () => void;
  kernel?: Kernel;
  spdif?: string;
  onEngineFailure?: (kernel: Kernel, reason: string) => void;
}) {
  const stateRef = useRef(state());
  const liveKindRef = useRef(false);
  const timeRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const resumeRef = useRef(0);
  const volumeRef = useRef(0.75);
  const handoffRef = useRef<{ url: string; paused: boolean } | null>(null);
  const skipSegmentsRef = useRef({ intro: 0, outro: 0 });
  const [view, setView] = useState({
    error: '',
    loading: false,
    paused: true,
    time: 0,
    duration: 0,
    buffered: 0,
    live: false,
    netSpeed: null as number | null,
    relaySpeed: null as number | null,
    buffering: false,
    resolution: '',
  });

  useMpvPlaybackSession({
    client,
    allowMpv: true,
    kernel,
    spdif,
    onEngineFailure,
    url: 'https://media.example/video.mp4',
    progressKey: 'profile-a-source-a',
    playbackSource: { profileId: 'profile-a', key: 'source-a' } satisfies PlaybackSourceRef,
    startTime,
    liveHint: false,
    rate: 1.25,
    fit: 'contain',
    stateRef,
    liveKindRef,
    timeRef,
    sizeRef,
    resumeRef,
    volumeRef,
    handoffRef,
    skipSegmentsRef,
    setMpvError: (error) => setView((current) => ({ ...current, error })),
    setLoading: (loading) => setView((current) => ({ ...current, loading })),
    setPaused: (paused) => setView((current) => ({ ...current, paused })),
    setCurrentTime: (time) => setView((current) => ({ ...current, time })),
    setDuration: (duration) => setView((current) => ({ ...current, duration })),
    setBuffered: (buffered) => setView((current) => ({ ...current, buffered })),
    setIsLive: (live) => setView((current) => ({ ...current, live })),
    setNetSpeed: (netSpeed) => setView((current) => ({ ...current, netSpeed })),
    setRelaySpeed: (relaySpeed) => setView((current) => ({ ...current, relaySpeed })),
    setBuffering: (buffering) => setView((current) => ({ ...current, buffering })),
    setPlaybackError: (error) => setView((current) => ({ ...current, error })),
    reportResolution: (width, height) => setView((current) => ({ ...current, resolution: `${width}x${height}` })),
    canAdvance: () => true,
    advance: onEnded,
    seek: () => undefined,
    showSkipToast: () => undefined,
    clearAuto: () => undefined,
    handlePlaybackEnd: onEnded,
  });

  return (
    <div>
      <output data-testid="error">{view.error}</output>
      <output data-testid="loading">{String(view.loading)}</output>
      <output data-testid="time">{String(view.time)}</output>
      <output data-testid="duration">{String(view.duration)}</output>
      <output data-testid="buffered">{String(view.buffered)}</output>
      <output data-testid="live">{String(view.live)}</output>
      <output data-testid="resolution">{view.resolution}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('useMpvPlaybackSession', () => {
  it('resumes from the requested position, records state and ignores stale session events', async () => {
    const { client, listeners } = makeClient();
    const { unmount } = render(<Harness client={client} />);
    await waitFor(() => expect(client.mpvStart).toHaveBeenCalledOnce());
    expect(client.mpvStart).toHaveBeenCalledWith(expect.objectContaining({
      startTime: 45,
      volume: 0.75,
      rate: 1.25,
      fit: 'contain',
    }));

    act(() => listeners[0]?.({ session: 7, state: state({ time: 60, duration: 120, loaded: true, paused: false, cacheTime: 80, cacheKbps: 512, videoW: 1920, videoH: 1080 }) }));
    expect(screen.getByTestId('time').textContent).toBe('60');
    expect(screen.getByTestId('duration').textContent).toBe('120');
    expect(screen.getByTestId('buffered').textContent).toBe('80');
    expect(screen.getByTestId('resolution').textContent).toBe('1920x1080');
    expect(getPlayTime('https://media.example/video.mp4', { profileId: 'profile-a', key: 'source-a' })).toBe(60);

    act(() => listeners[0]?.({ session: 6, state: state({ time: 99, duration: 120 }) }));
    expect(screen.getByTestId('time').textContent).toBe('60');

    unmount();
    expect(client.mpvStop).toHaveBeenCalledOnce();
    act(() => listeners[0]?.({ session: 7, state: state({ time: 100 }) }));
    expect(listeners).toHaveLength(0);
  });

  it('reports a demux failure instead of advancing when EOF arrives before playback starts', async () => {
    const { client, listeners } = makeClient();
    const onEnded = vi.fn();
    render(<Harness client={client} onEnded={onEnded} />);
    await waitFor(() => expect(client.mpvStart).toHaveBeenCalledOnce());

    act(() => listeners[0]?.({ session: 7, state: state({ eof: true, playbackStarted: false }) }));

    expect(screen.getByTestId('error').textContent).toContain('分片读取失败');
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('handles playback EOF once after the session has actually started', async () => {
    const { client, listeners } = makeClient();
    const onEnded = vi.fn();
    render(<Harness client={client} onEnded={onEnded} />);
    await waitFor(() => expect(client.mpvStart).toHaveBeenCalledOnce());

    act(() => {
      listeners[0]?.({ session: 7, state: state({ eof: true, playbackStarted: true }) });
      listeners[0]?.({ session: 7, state: state({ eof: true, playbackStarted: true }) });
    });

    expect(onEnded).toHaveBeenCalledOnce();
  });

  it('waits for the start acknowledgement before accepting early session events', async () => {
    const { client, listeners } = makeClient();
    const onEnded = vi.fn();
    let acknowledge!: (value: { session: number }) => void;
    vi.mocked(client.mpvStart).mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    render(<Harness client={client} startTime={5} onEnded={onEnded} />);
    act(() => {
      listeners[0]?.({ session: 6, state: state({ time: 99, eof: true, playbackStarted: true }) });
      listeners[0]?.({ session: 7, state: state({ time: 61, loaded: true }) });
    });
    expect(screen.getByTestId('time').textContent).toBe('5');
    expect(onEnded).not.toHaveBeenCalled();
    await act(async () => { acknowledge({ session: 7 }); });
    expect(screen.getByTestId('time').textContent).toBe('61');
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('uses the selected plugin engine channel and preserves audio passthrough', async () => {
    const { client, listeners } = makeClient();
    const engineListeners: Array<(event: MpvStateEvent) => void> = [];
    client.engineOnState = callback => { engineListeners.push(callback); return () => { engineListeners.splice(engineListeners.indexOf(callback), 1); }; };
    client.engineStart = vi.fn(async () => ({ ok: true, session: 41 }));
    client.engineCmd = vi.fn(async () => undefined);
    client.engineStop = vi.fn(async () => undefined);
    const view = render(<Harness client={client} kernel="engine:test" spdif="ac3,eac3,truehd" />);
    await waitFor(() => expect(client.engineCmd).toHaveBeenCalledWith({ type: 'audio-spdif', value: 'ac3,eac3,truehd' }));
    expect(client.engineStart).toHaveBeenCalledWith(expect.objectContaining({ engineId: 'engine:test' }));
    expect(client.mpvStart).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(0);
    act(() => engineListeners[0]?.({ session: 41, state: state({ time: 72, loaded: true }) }));
    expect(screen.getByTestId('time').textContent).toBe('72');
    view.unmount();
    expect(client.engineStop).toHaveBeenCalledOnce();
    expect(client.mpvStop).not.toHaveBeenCalled();
    expect(engineListeners).toHaveLength(0);
  });

  it('reports a selected plugin engine startup failure to the fallback handler', async () => {
    const { client } = makeClient();
    const onEngineFailure = vi.fn();
    client.engineStart = vi.fn(async () => ({ ok: false, reason: 'not ready' }));
    render(<Harness client={client} kernel="engine:test" onEngineFailure={onEngineFailure} />);
    await waitFor(() => expect(onEngineFailure).toHaveBeenCalledWith('engine:test', 'not ready'));
    expect(screen.getByTestId('error').textContent).toContain('not ready');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
});
