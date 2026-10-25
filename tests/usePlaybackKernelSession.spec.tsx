// @vitest-environment happy-dom
import { useMemo, useRef, useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyMpvKernelState, type MpvKernelState, type MpvStartOptions, type MpvStateEvent } from '../src/shared/player';
import type { PlaybackSourceRef } from '../src/renderer/lib/playbackProgress';
import { usePlaybackKernelSession } from '../src/renderer/features/playback/usePlaybackKernelSession';
import type { PlaybackKernelSessionPort } from '../src/renderer/features/playback/application/mpvPlaybackPorts';
import type { PlaybackPositionMemoryPort } from '../src/renderer/features/playback/application/playbackSessionPorts';
import type { Kernel } from '../src/renderer/lib/kernel';
import { createPlaybackHandoffPort, type PlaybackHandoff } from '../src/renderer/features/playback/application/playbackHandoff';
import { createPlaybackSessionStatePort } from '../src/renderer/features/playback/application/playbackSessionState';

const storedPositions = new Map<string, number>();
const positionKey = (url: string, scope?: PlaybackSourceRef) => `${scope?.profileId ?? ''}:${scope?.key ?? ''}:${url}`;
const positionMemory: PlaybackPositionMemoryPort = {
  read: (url, scope) => storedPositions.get(positionKey(url, scope)) ?? 0,
  save: (url, seconds, scope) => { storedPositions.set(positionKey(url, scope), seconds); },
};

function state(overrides: Partial<MpvKernelState> = {}): MpvKernelState {
  return { ...emptyMpvKernelState(), ...overrides };
}

function makeClient() {
  const listeners: Array<(event: MpvStateEvent) => void> = [];
  const client: PlaybackKernelSessionPort = {
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
    engineOnState: () => () => undefined,
    engineStart: vi.fn(async () => ({ ok: true, session: 41 })),
    engineCmd: vi.fn(async () => undefined),
    engineStop: vi.fn(async () => undefined),
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
  initialHandoff = null,
  progressKey = 'profile-a-source-a',
}: {
  client: PlaybackKernelSessionPort;
  startTime?: number;
  onEnded?: () => void;
  kernel?: Kernel;
  spdif?: string;
  onEngineFailure?: (kernel: Kernel, reason: string) => void;
  initialHandoff?: PlaybackHandoff | null;
  progressKey?: string;
}) {
  const stateRef = useRef(state());
  const timeRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const volumeRef = useRef(0.75);
  const handoff = useMemo(() => {
    const port = createPlaybackHandoffPort();
    if (initialHandoff) port.stage(initialHandoff);
    return port;
  }, []);
  const skipSegmentsRef = useRef({ intro: 0, outro: 0 });
  const sessionState = useMemo(() => createPlaybackSessionStatePort(() => skipSegmentsRef.current), []);
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

  usePlaybackKernelSession({
    port: client,
    allowMpv: true,
    kernel,
    spdif,
    onEngineFailure,
    url: 'https://media.example/video.mp4',
    progressKey,
    playbackSource: { profileId: 'profile-a', key: 'source-a' } satisfies PlaybackSourceRef,
    positionMemory,
    startTime,
    liveHint: false,
    rate: 1.25,
    fit: 'contain',
    stateRef,
    sessionState,
    timeRef,
    sizeRef,
    volumeRef,
    handoff,
    updatePlaybackStatus: (update) => setView((current) => ({
      ...current,
      ...(update.error !== undefined ? { error: update.error } : {}),
      ...(update.mpvError !== undefined ? { error: update.mpvError } : {}),
      ...(update.loading !== undefined ? { loading: update.loading } : {}),
      ...(update.paused !== undefined ? { paused: update.paused } : {}),
      ...(update.currentTime !== undefined ? { time: update.currentTime } : {}),
      ...(update.duration !== undefined ? { duration: update.duration } : {}),
      ...(update.buffered !== undefined ? { buffered: update.buffered } : {}),
      ...(update.isLive !== undefined ? { live: update.isLive } : {}),
      ...(update.netSpeed !== undefined ? { netSpeed: update.netSpeed } : {}),
      ...(update.relaySpeed !== undefined ? { relaySpeed: update.relaySpeed } : {}),
      ...(update.buffering !== undefined ? { buffering: update.buffering } : {}),
    })),
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
  storedPositions.clear();
  localStorage.clear();
});

describe('usePlaybackKernelSession', () => {
  it.each<Partial<PlaybackHandoff>>([
    { url: 'https://media.example/old.mp4' }, { progressKey: 'another-profile-source' }, { kernel: 'html5' },
  ])('ignores position and pause state from a different playback handoff: %j', async (overrides) => {
    const { client } = makeClient();
    render(<Harness client={client} initialHandoff={{
      url: 'https://media.example/video.mp4', progressKey: 'profile-a-source-a', kernel: 'mpv', position: 80, paused: true, ...overrides,
    }} />);
    await waitFor(() => expect(client.mpvStart).toHaveBeenCalledOnce());
    expect(client.mpvStart).toHaveBeenCalledWith(expect.objectContaining({ startTime: 45, paused: false }));
  });

  it('resumes the matching handoff and does not carry its pause state into a new profile', async () => {
    const { client } = makeClient();
    const { rerender } = render(<Harness client={client} initialHandoff={{
      url: 'https://media.example/video.mp4', progressKey: 'profile-a-source-a', kernel: 'mpv', position: 80, paused: true,
    }} />);
    await waitFor(() => expect(client.mpvStart).toHaveBeenCalledOnce());
    expect(client.mpvStart).toHaveBeenCalledWith(expect.objectContaining({ startTime: 80, paused: true }));
    rerender(<Harness client={client} progressKey="another-profile-source" />);
    await waitFor(() => expect(client.mpvStart).toHaveBeenCalledTimes(2));
    expect(client.mpvStart).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: 45, paused: false }));
  });

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
    expect(positionMemory.read('https://media.example/video.mp4', { profileId: 'profile-a', key: 'source-a' })).toBe(60);

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
