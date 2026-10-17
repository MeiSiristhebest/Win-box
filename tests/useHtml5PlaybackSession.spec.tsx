// @vitest-environment happy-dom
import { useCallback, useRef, useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSourceRef } from '../src/renderer/lib/playbackProgress';
import type { PlayerPrefs } from '../src/renderer/lib/playerPrefs';
import { getPlayTime } from '../src/renderer/lib/uiMemory';
import { useHtml5PlaybackSession } from '../src/renderer/features/playback/useHtml5PlaybackSession';

const playbackUrl = 'https://media.example/video.mp4';
const playbackSource: PlaybackSourceRef = { profileId: 'profile-a', key: 'source-a' };

function Harness({
  pausedHandoff = false,
  onEnded = () => undefined,
  clearAuto = () => undefined,
}: {
  pausedHandoff?: boolean;
  onEnded?: () => void;
  clearAuto?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prefsRef = useRef<PlayerPrefs>({ vol: 0.6, rate: 1.5, subOffset: 0, fit: 'contain', kernel: 'auto' });
  const bossActiveRef = useRef(false);
  const liveKindRef = useRef(false);
  const resumeRef = useRef(0);
  const volumeHandoffRef = useRef(pausedHandoff ? { url: playbackUrl, paused: true } : null);
  const skipSegmentsRef = useRef({ intro: 0, outro: 0 });
  const introFiredRef = useRef(false);
  const outroFiredRef = useRef(false);
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
    url: playbackUrl,
    htmlUrl: playbackUrl,
    progressKey: 'profile-a-source-a',
    kernel: 'html5',
    isImage: false,
    isAudio: false,
    liveHint: false,
    playbackSource,
    startTime: 45,
    prefsRef,
    bossActiveRef,
    liveKindRef,
    resumeRef,
    volumeHandoffRef,
    skipSegmentsRef,
    introFiredRef,
    outroFiredRef,
    setError: (error) => setView((current) => ({ ...current, error })),
    setMpvError: (mpvError) => setView((current) => ({ ...current, mpvError })),
    setLoading: (loading) => setView((current) => ({ ...current, loading })),
    setPaused: (paused) => setView((current) => ({ ...current, paused })),
    setCurrentTime: (time) => setView((current) => ({ ...current, time })),
    setDuration: (duration) => setView((current) => ({ ...current, duration })),
    setIsLive: (live) => setView((current) => ({ ...current, live })),
    setNetSpeed: (netSpeed) => setView((current) => ({ ...current, netSpeed })),
    setRelaySpeed: (relaySpeed) => setView((current) => ({ ...current, relaySpeed })),
    setBuffering: (buffering) => setView((current) => ({ ...current, buffering })),
    clearAuto,
    revealControls: () => undefined,
    tryMpvFallback: () => false,
    handlePlaybackEnd: onEnded,
    canAdvance: () => true,
    advance: onEnded,
    showSkipToast: () => undefined,
    formatTime: (seconds) => `${seconds}s`,
  });

  return (
    <div>
      <video data-testid="video" ref={bindVideo} />
      <output data-testid="view">{JSON.stringify(view)}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useHtml5PlaybackSession', () => {
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
    expect(getPlayTime(playbackUrl, playbackSource)).toBe(52);

    act(() => video.dispatchEvent(new Event('playing')));
    expect(screen.getByTestId('view').textContent).toContain('"buffering":false');
    act(() => video.dispatchEvent(new Event('ended')));
    expect(onEnded).toHaveBeenCalledOnce();

    unmount();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.hasAttribute('src')).toBe(false);
    expect(clearAuto).toHaveBeenCalledOnce();
    expect(getPlayTime(playbackUrl, playbackSource)).toBe(52);
  });

  it('keeps a paused kernel handoff paused instead of autoplaying', async () => {
    render(<Harness pausedHandoff />);
    const video = screen.getByTestId('video') as HTMLVideoElement;
    await waitFor(() => expect(video.src).toBe(playbackUrl));

    expect(video.play).not.toHaveBeenCalled();
    expect(screen.getByTestId('view').textContent).toContain('"paused":true');
  });
});
