// @vitest-environment happy-dom
import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSourceRef } from '../src/renderer/lib/playbackProgress';
import type { Kernel } from '../src/renderer/lib/kernel';
import type { PlayerPrefs } from '../src/renderer/lib/playerPrefs';
import { useHtml5PlaybackSession } from '../src/renderer/features/playback/useHtml5PlaybackSession';
import { createPlaybackHandoffPort, type PlaybackHandoff } from '../src/renderer/features/playback/application/playbackHandoff';
import { createPlaybackSessionStatePort } from '../src/renderer/features/playback/application/playbackSessionState';
import type { MediaDiagnosticsPort } from '../src/renderer/features/playback/application/mediaDiagnostics';
import type { PlaybackPositionMemoryPort, PlaybackRuntimePort } from '../src/renderer/features/playback/application/playbackSessionPorts';
import type { AdaptiveAudioTrackController } from '../src/renderer/features/playback/application/playerAudioTracks';

const hlsTestState = vi.hoisted(() => ({
  destroyed: 0,
  instances: [] as Array<{
    errorHandler?: (...args: unknown[]) => void;
    startLoads: number;
    mediaRecoveries: number;
    destroyed: boolean;
  }>,
}));
vi.mock('hls.js', () => {
  const Events = {
    MANIFEST_PARSED: 'manifest-parsed', AUDIO_TRACKS_UPDATED: 'audio-tracks-updated',
    AUDIO_TRACK_SWITCHED: 'audio-track-switched', LEVEL_LOADED: 'level-loaded',
    FRAG_LOADED: 'fragment-loaded', ERROR: 'error',
  };
  class MockHls {
    static Events = Events;
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static isSupported = () => true;
    audioTrack = 1;
    audioTracks = [
      { name: '国语', lang: 'chi', attrs: { CHANNELS: '2' } },
      { name: '日本語', lang: 'jpn', attrs: { CHANNELS: '6' } },
    ];
    instanceState = { startLoads: 0, mediaRecoveries: 0, destroyed: false } as {
      errorHandler?: (...args: unknown[]) => void;
      startLoads: number;
      mediaRecoveries: number;
      destroyed: boolean;
    };
    constructor() { hlsTestState.instances.push(this.instanceState); }
    loadSource() {}
    attachMedia() {}
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === Events.ERROR) this.instanceState.errorHandler = handler;
    }
    startLoad() { this.instanceState.startLoads++; }
    recoverMediaError() { this.instanceState.mediaRecoveries++; }
    destroy() { this.instanceState.destroyed = true; hlsTestState.destroyed++; }
  }
  return { default: MockHls };
});

const playbackUrl = 'https://media.example/video.mp4';
const playbackSource: PlaybackSourceRef = { profileId: 'profile-a', key: 'source-a' };
const mediaDiagnostics: MediaDiagnosticsPort = { report: async () => undefined };
const storedPositions = new Map<string, number>();
const positionKey = (url: string, scope?: PlaybackSourceRef) => `${scope?.profileId ?? ''}:${scope?.key ?? ''}:${url}`;
const positionMemory: PlaybackPositionMemoryPort = {
  read: (url, scope) => storedPositions.get(positionKey(url, scope)) ?? 0,
  save: (url, seconds, scope) => { storedPositions.set(positionKey(url, scope), seconds); },
};
const playbackRuntime: PlaybackRuntimePort = { isDesktopRuntime: () => false };
const desktopRuntime: PlaybackRuntimePort = { isDesktopRuntime: () => true };

function emitFatalHlsError(instanceIndex: number, type: 'networkError' | 'mediaError', responseStatus?: number) {
  const errorHandler = hlsTestState.instances[instanceIndex]?.errorHandler;
  errorHandler?.('error', {
    fatal: true,
    type,
    details: type === 'networkError' ? 'fragLoadError' : 'bufferAppendError',
    response: responseStatus === undefined ? undefined : { code: responseStatus },
  });
}

function Harness({
  pausedHandoff = false,
  onEnded = () => undefined,
  clearAuto = () => undefined,
  tryExternalFallback,
  kernel = 'html5',
  initialHandoff,
  recoverHtmlPlayback = () => false,
  runtime = playbackRuntime,
  adaptiveAudioTracksRef,
  url = playbackUrl,
}: {
  pausedHandoff?: boolean;
  onEnded?: () => void;
  clearAuto?: () => void;
  tryExternalFallback?: (sourceUrl: string, position: number) => Promise<{ opened: boolean; player?: string; error?: string } | null>;
  kernel?: Kernel;
  initialHandoff?: PlaybackHandoff;
  recoverHtmlPlayback?: () => boolean;
  runtime?: PlaybackRuntimePort;
  adaptiveAudioTracksRef?: MutableRefObject<AdaptiveAudioTrackController | null>;
  url?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prefsRef = useRef<PlayerPrefs>({ vol: 0.6, rate: 1.5, subOffset: 0, fit: 'contain', kernel: 'auto', spdif: '' });
  const bossActiveRef = useRef(false);
  const handoff = useMemo(() => {
    const port = createPlaybackHandoffPort();
    const initial = initialHandoff ?? (pausedHandoff ? { url: playbackUrl, progressKey: 'profile-a-source-a', kernel: 'html5' as const, position: 0, paused: true } : null);
    if (initial) port.stage(initial);
    return port;
  }, []);
  const skipSegmentsRef = useRef({ intro: 0, outro: 0 });
  const sessionState = useMemo(() => createPlaybackSessionStatePort(() => skipSegmentsRef.current), []);
  const [view, setView] = useState({
    error: '',
    mpvError: '',
    loading: false,
    paused: true,
    time: 0,
    duration: 0,
    live: false,
    netSpeed: null as number | null,
    relaySpeed: null as number | null,
    buffering: false,
  });
  const bindVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (!video) return;
    Object.defineProperty(video, 'paused', { configurable: true, writable: true, value: true });
    Object.defineProperty(video, 'duration', { configurable: true, writable: true, value: 120 });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    video.play = vi.fn(async () => {
      Object.defineProperty(video, 'paused', { configurable: true, writable: true, value: false });
    });
    video.pause = vi.fn(() => {
      Object.defineProperty(video, 'paused', { configurable: true, writable: true, value: true });
    });
    video.load = vi.fn();
    video.canPlayType = vi.fn((): CanPlayTypeResult => 'probably');
  }, []);

  useHtml5PlaybackSession({
    videoRef,
    url,
    htmlUrl: url,
    progressKey: 'profile-a-source-a',
    kernel,
    isImage: false,
    isAudio: false,
    liveHint: false,
    playbackSource,
    positionMemory,
    runtime,
    adaptiveAudioTracksRef,
    startTime: 45,
    prefsRef,
    bossActiveRef,
    sessionState,
    handoff,
    updatePlaybackStatus: (update) => setView((current) => ({
      ...current,
      ...(update.error !== undefined ? { error: update.error } : {}),
      ...(update.mpvError !== undefined ? { mpvError: update.mpvError } : {}),
      ...(update.loading !== undefined ? { loading: update.loading } : {}),
      ...(update.paused !== undefined ? { paused: update.paused } : {}),
      ...(update.currentTime !== undefined ? { time: update.currentTime } : {}),
      ...(update.duration !== undefined ? { duration: update.duration } : {}),
      ...(update.isLive !== undefined ? { live: update.isLive } : {}),
      ...(update.netSpeed !== undefined ? { netSpeed: update.netSpeed } : {}),
      ...(update.relaySpeed !== undefined ? { relaySpeed: update.relaySpeed } : {}),
      ...(update.buffering !== undefined ? { buffering: update.buffering } : {}),
    })),
    clearAuto,
    revealControls: () => undefined,
    recoverHtmlPlayback,
    tryExternalFallback,
    handlePlaybackEnd: onEnded,
    canAdvance: () => true,
    advance: onEnded,
    showSkipToast: () => undefined,
    formatTime: (seconds) => `${seconds}s`,
  }, mediaDiagnostics);

  return (
    <div>
      <video data-testid="video" ref={bindVideo} />
      <output data-testid="view">{JSON.stringify(view)}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
  storedPositions.clear();
  localStorage.clear();
  hlsTestState.destroyed = 0;
  hlsTestState.instances = [];
  vi.restoreAllMocks();
});

describe('useHtml5PlaybackSession', () => {
  it('publishes only the adaptive audio-track capability and clears it on session teardown', async () => {
    const adaptiveAudioTracksRef: MutableRefObject<AdaptiveAudioTrackController | null> = { current: null };
    const desktopRuntime: PlaybackRuntimePort = { isDesktopRuntime: () => true };
    const { unmount } = render(<Harness runtime={desktopRuntime} adaptiveAudioTracksRef={adaptiveAudioTracksRef} url="https://media.example/live.m3u8" />);

    await waitFor(() => expect(adaptiveAudioTracksRef.current).not.toBeNull());
    expect(adaptiveAudioTracksRef.current?.read()).toEqual({
      tracks: [
        { id: 0, title: '国语', lang: 'chi', channels: '2', selected: undefined },
        { id: 1, title: '日本語', lang: 'jpn', channels: '6', selected: true },
      ],
      selectedTrackId: 1,
    });
    expect(screen.getByTestId('video').getAttribute('src')).toBeNull();

    unmount();
    expect(adaptiveAudioTracksRef.current).toBeNull();
    expect(hlsTestState.destroyed).toBe(1);
  });

  it('does not launch an external player when a selected kernel is already taking over', async () => {
    const tryExternalFallback = vi.fn(async () => ({ opened: true }));
    render(<Harness recoverHtmlPlayback={() => true} tryExternalFallback={tryExternalFallback} />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 4, message: 'Unsupported codec' } });
    act(() => video.dispatchEvent(new Event('error')));
    expect(tryExternalFallback).not.toHaveBeenCalled();
    expect(screen.getByTestId('view').textContent).toContain('"error":""');
  });

  it.each<Partial<PlaybackHandoff>>([
    { url: 'https://media.example/old.mp4' }, { progressKey: 'another-profile-source' }, { kernel: 'mpv' },
  ])('ignores position and pause state from a different playback handoff: %j', async (overrides) => {
    render(<Harness initialHandoff={{
      url: playbackUrl, progressKey: 'profile-a-source-a', kernel: 'html5', position: 80, paused: true, ...overrides,
    }} />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    act(() => video.dispatchEvent(new Event('durationchange')));
    expect(video.currentTime).toBe(45);
  });

  it('restores a matching kernel handoff position while retaining an explicit pause', async () => {
    render(<Harness initialHandoff={{ url: playbackUrl, progressKey: 'profile-a-source-a', kernel: 'html5', position: 80, paused: true }} />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    act(() => video.dispatchEvent(new Event('durationchange')));
    expect(video.currentTime).toBe(80);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('stops HTML playback when a plugin takes over and does not start a second stream', async () => {
    const { rerender } = render(<Harness />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    rerender(<Harness kernel="engine:test-player" />);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
    act(() => video.dispatchEvent(new Event('play')));
    expect(video.hasAttribute('src')).toBe(false);
  });

  it('restores and saves profile-scoped progress, updates media state, and cleans up', async () => {
    const onEnded = vi.fn();
    const clearAuto = vi.fn();
    const { unmount } = render(<Harness onEnded={onEnded} clearAuto={clearAuto} />);
    const video = screen.getByTestId('video') as HTMLVideoElement;

    await waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    expect(video.volume).toBe(0.6);
    expect(video.playbackRate).toBe(1.5);
    expect(screen.getByTestId('view').textContent).toContain('"paused":false');

    act(() => video.dispatchEvent(new Event('canplay')));
    expect(screen.getByTestId('view').textContent).toContain('"loading":false');

    act(() => video.dispatchEvent(new Event('durationchange')));
    expect(video.currentTime).toBe(45);
    expect(screen.getByTestId('view').textContent).toContain('"duration":120');

    act(() => {
      video.currentTime = 52;
      video.dispatchEvent(new Event('timeupdate'));
      video.dispatchEvent(new Event('waiting'));
    });
    expect(screen.getByTestId('view').textContent).toContain('"time":52');
    expect(screen.getByTestId('view').textContent).toContain('"buffering":true');
    expect(positionMemory.read(playbackUrl, playbackSource)).toBe(52);

    act(() => video.dispatchEvent(new Event('playing')));
    expect(screen.getByTestId('view').textContent).toContain('"buffering":false');
    act(() => video.dispatchEvent(new Event('ended')));
    expect(onEnded).toHaveBeenCalledOnce();

    unmount();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.hasAttribute('src')).toBe(false);
    expect(clearAuto).toHaveBeenCalledOnce();
    expect(positionMemory.read(playbackUrl, playbackSource)).toBe(52);
  });

  it('keeps a paused kernel handoff paused instead of autoplaying', async () => {
    render(<Harness pausedHandoff />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    await waitFor(() => expect(video.src).toBe(playbackUrl));

    expect(video.play).not.toHaveBeenCalled();
    expect(screen.getByTestId('view').textContent).toContain('"paused":true');
  });

  it('hands unsupported media to the configured external player once', async () => {
    const tryExternalFallback = vi.fn(async () => ({ opened: true, player: 'PotPlayer' }));
    const recoverHtmlPlayback = vi.fn(() => false);
    render(<Harness recoverHtmlPlayback={recoverHtmlPlayback} tryExternalFallback={tryExternalFallback} />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    Object.defineProperty(video, 'error', {
      configurable: true,
      value: { code: 4, message: 'PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE' },
    });

    act(() => {
      video.dispatchEvent(new Event('error'));
      video.dispatchEvent(new Event('error'));
    });

    await waitFor(() => expect(tryExternalFallback).toHaveBeenCalledOnce());
    expect(recoverHtmlPlayback).toHaveBeenCalledOnce();
    expect(tryExternalFallback).toHaveBeenCalledWith(playbackUrl, 45);
    await waitFor(() => expect(screen.getByTestId('view').textContent).toContain('已交给PotPlayer播放'));
  });

  it('shows the external-player startup failure instead of leaving an unsupported media error ambiguous', async () => {
    const tryExternalFallback = vi.fn(async () => ({ opened: false, error: '播放器未安装' }));
    render(<Harness tryExternalFallback={tryExternalFallback} />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    await waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 4, message: 'Unsupported codec' } });

    act(() => video.dispatchEvent(new Event('error')));

    await waitFor(() => expect(screen.getByTestId('view').textContent).toContain('外部播放器启动失败：播放器未安装'));
    expect(tryExternalFallback).toHaveBeenCalledOnce();
  });

  it('does not retry an HLS upstream rejection and does not ask the kernel to take over', async () => {
    const recoverHtmlPlayback = vi.fn(() => true);
    render(<Harness url="https://media.example/live.m3u8" runtime={desktopRuntime} recoverHtmlPlayback={recoverHtmlPlayback} />);
    await waitFor(() => expect(hlsTestState.instances[0]?.errorHandler).toBeTypeOf('function'));

    act(() => emitFatalHlsError(0, 'networkError', 404));

    expect(hlsTestState.instances[0]?.startLoads).toBe(0);
    expect(recoverHtmlPlayback).not.toHaveBeenCalled();
    expect(screen.getByTestId('view').textContent).toContain('HLS 播放失败');
  });

  it('exhausts bounded HLS network retries before requesting kernel recovery', async () => {
    const recoverHtmlPlayback = vi.fn(() => false);
    render(<Harness url="https://media.example/live.m3u8" runtime={desktopRuntime} recoverHtmlPlayback={recoverHtmlPlayback} />);
    await waitFor(() => expect(hlsTestState.instances[0]?.errorHandler).toBeTypeOf('function'));

    act(() => {
      emitFatalHlsError(0, 'networkError', 503);
      emitFatalHlsError(0, 'networkError', 503);
    });
    expect(hlsTestState.instances[0]?.startLoads).toBe(2);
    act(() => emitFatalHlsError(0, 'networkError', 503));

    expect(recoverHtmlPlayback).toHaveBeenCalledOnce();
    expect(screen.getByTestId('view').textContent).toContain('已自动重试 2 次');
  });

  it('recovers HLS decode failures twice before requesting a compatible kernel', async () => {
    const recoverHtmlPlayback = vi.fn(() => true);
    render(<Harness url="https://media.example/live.m3u8" runtime={desktopRuntime} recoverHtmlPlayback={recoverHtmlPlayback} />);
    await waitFor(() => expect(hlsTestState.instances[0]?.errorHandler).toBeTypeOf('function'));

    act(() => {
      emitFatalHlsError(0, 'mediaError');
      emitFatalHlsError(0, 'mediaError');
    });
    expect(hlsTestState.instances[0]?.mediaRecoveries).toBe(2);
    act(() => emitFatalHlsError(0, 'mediaError'));

    expect(recoverHtmlPlayback).toHaveBeenCalledOnce();
    expect(screen.getByTestId('view').textContent).not.toContain('HLS 播放失败');
  });

  it('isolates late HLS errors from the previous URL session', async () => {
    const { rerender } = render(<Harness url="https://media.example/first.m3u8" runtime={desktopRuntime} />);
    await waitFor(() => expect(hlsTestState.instances[0]?.errorHandler).toBeTypeOf('function'));
    const staleHandler = hlsTestState.instances[0]?.errorHandler;

    rerender(<Harness url="https://media.example/second.m3u8" runtime={desktopRuntime} />);
    await waitFor(() => expect(hlsTestState.instances).toHaveLength(2));
    expect(hlsTestState.instances[0]?.destroyed).toBe(true);

    act(() => staleHandler?.('error', {
      fatal: true,
      type: 'networkError',
      details: 'fragLoadError',
      response: { code: 503 },
    }));
    expect(hlsTestState.instances[0]?.startLoads).toBe(0);

    act(() => emitFatalHlsError(1, 'networkError', 503));
    expect(hlsTestState.instances[1]?.startLoads).toBe(1);
  });
});
