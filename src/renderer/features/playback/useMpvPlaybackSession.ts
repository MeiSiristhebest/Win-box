import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type { MpvAudioTrack, MpvCommand, MpvKernelState, MpvStartOptions, MpvStateEvent } from '../../../shared/player';
import { emptyMpvKernelState, normalizeSpdif } from '../../../shared/player';
import { isEngineKernel, type Kernel } from '../../lib/kernel';
import type { PlaybackSourceRef } from '../../lib/playbackProgress';
import { getPlayTime, setPlayTime } from '../../lib/uiMemory';
import { shouldSkipIntro, shouldSkipOutro, type SkipSeg } from '../../lib/skipSegments';
import type { PlayerFit } from '../../lib/playerPrefs';
import { resolveResumePosition, toMpvStartPosition } from './resumePosition';

export interface MpvPlaybackSessionClient {
  mpvOnState(callback: (state: MpvStateEvent) => void): () => void;
  mpvStart(options: MpvStartOptions): Promise<{ session: number }>;
  mpvCmd(command: MpvCommand): Promise<unknown>;
  mpvStop(): Promise<unknown>;
  engineOnState?: (callback: (state: MpvStateEvent) => void) => () => void;
  engineStart?: (options: MpvStartOptions & { engineId: string }) => Promise<{ ok: boolean; session?: number; reason?: string }>;
  engineCmd?: (command: MpvCommand) => Promise<unknown>;
  engineStop?: () => Promise<unknown>;
}

export interface MpvPlaybackSessionOptions {
  client: MpvPlaybackSessionClient;
  allowMpv: boolean;
  kernel: Kernel;
  spdif?: string;
  onState?: (state: MpvKernelState) => void;
  onEngineFailure?: (kernel: Kernel, reason: string) => void;
  url: string;
  progressKey: string;
  playbackSource?: PlaybackSourceRef;
  startTime?: number;
  liveHint: boolean;
  rate: number;
  fit: PlayerFit;
  stateRef: MutableRefObject<MpvKernelState>;
  liveKindRef: MutableRefObject<boolean>;
  timeRef: MutableRefObject<number>;
  sizeRef: MutableRefObject<{ w: number; h: number }>;
  resumeRef: MutableRefObject<number>;
  volumeRef: MutableRefObject<number>;
  handoffRef: MutableRefObject<{ url: string; paused: boolean } | null>;
  skipSegmentsRef: MutableRefObject<SkipSeg>;
  setMpvError(value: string): void;
  setLoading(value: boolean): void;
  setPaused(value: boolean): void;
  setCurrentTime(value: number): void;
  setDuration(value: number): void;
  setBuffered(value: number): void;
  setIsLive(value: boolean): void;
  setNetSpeed(value: number | null): void;
  setRelaySpeed(value: number | null): void;
  setBuffering(value: boolean): void;
  setPlaybackError(value: string): void;
  reportResolution(width: unknown, height: unknown): void;
  canAdvance(): boolean;
  advance(): void;
  seek(time: number): void;
  showSkipToast(message: string): void;
  clearAuto(): void;
  handlePlaybackEnd(): void;
  onAudioTracks?: (tracks: MpvAudioTrack[], aid: number | null) => void;
}

/** Owns MPV event subscription, session startup, stale-event filtering and teardown. */
export function useMpvPlaybackSession(options: MpvPlaybackSessionOptions): void {
  const {
    client,
    allowMpv,
    kernel,
    url,
    progressKey,
    playbackSource,
    startTime,
    liveHint,
    rate,
    fit,
    stateRef,
    liveKindRef,
    timeRef,
    sizeRef,
    resumeRef,
    volumeRef,
    handoffRef,
    skipSegmentsRef,
    setMpvError,
    setLoading,
    setPaused,
    setCurrentTime,
    setDuration,
    setBuffered,
    setIsLive,
    setNetSpeed,
    setRelaySpeed,
    setBuffering,
    setPlaybackError,
    reportResolution,
    canAdvance,
    advance,
    seek,
    showSkipToast,
    clearAuto,
    handlePlaybackEnd,
  } = options;
  const audioTracksRef = useRef(options.onAudioTracks);
  useLayoutEffect(() => { audioTracksRef.current = options.onAudioTracks; }, [options.onAudioTracks]);
  const latestOptions = useRef(options);
  useLayoutEffect(() => { latestOptions.current = options; }, [options]);
  const sessionRef = useRef(0);
  const pushRef = useRef<((state: MpvStateEvent) => void) | null>(null);

  useEffect(() => {
    if (!allowMpv) return;
    if (isEngineKernel(kernel)) return client.engineOnState?.((state) => pushRef.current?.(state));
    if (kernel === 'mpv') return client.mpvOnState((state) => pushRef.current?.(state));
  }, [allowMpv, client, kernel]);

  useEffect(() => {
    if (!allowMpv || kernel === 'html5' || !url) return;
    const engine = isEngineKernel(kernel);
    const label = engine ? '插件内核' : 'MPV 内核';
    const command = (cmd: MpvCommand) => engine ? client.engineCmd?.(cmd) ?? Promise.resolve() : client.mpvCmd(cmd);
    let alive = true;
    const saved = resolveResumePosition({
      kernelPosition: resumeRef.current,
      startTime,
      storedPosition: getPlayTime(url, playbackSource),
    });
    resumeRef.current = 0;
    const startAt = toMpvStartPosition(saved);

    setPlaybackError('');
    setMpvError('');
    setLoading(true);
    setPaused(true);
    setCurrentTime(startAt);
    setDuration(0);
    setBuffered(0);
    setIsLive(liveHint);
    setNetSpeed(null);
    setRelaySpeed(null);
    setBuffering(false);
    stateRef.current = emptyMpvKernelState(liveHint);
    liveKindRef.current = liveHint;
    timeRef.current = startAt;
    sizeRef.current = { w: 0, h: 0 };
    sessionRef.current = 0;

    let introFired = skipSegmentsRef.current.intro > 0.5 && startAt >= skipSegmentsRef.current.intro;
    let outroFired = false;
    let eofFired = false;
    let pendingEvents: MpvStateEvent[] = [];

    const maybeSkip = (time: number, duration: number) => {
      if (liveKindRef.current) return;
      const segments = skipSegmentsRef.current;
      if (!segments.intro && !segments.outro) return;
      if (segments.intro > 0.5 && shouldSkipIntro(time, duration, segments, introFired)) {
        introFired = true;
        seek(segments.intro);
        showSkipToast(`已跳过片头 ${formatTime(segments.intro)}`);
        return;
      }
      if (shouldSkipOutro(time, duration, segments, outroFired)) {
        outroFired = true;
        if (canAdvance()) {
          showSkipToast(`已跳过片尾 ${formatTime(segments.outro)}，播放下一集…`);
          advance();
        }
      }
    };

    pushRef.current = (event) => {
      if (!alive || sessionRef.current === -1) return;
      if (sessionRef.current === 0) {
        // Startup can publish state before its acknowledgement. Only the acknowledged session is authoritative.
        if (pendingEvents.length >= 32) pendingEvents.shift();
        pendingEvents.push(event);
        return;
      }
      if (event.session !== sessionRef.current) return;

      const state = { ...stateRef.current, ...event.state };
      stateRef.current = state;
      latestOptions.current.onState?.(state);
      audioTracksRef.current?.(state.audioTracks ?? [], state.aid ?? null);
      liveKindRef.current = state.live;
      setIsLive(state.live);
      timeRef.current = state.time ?? 0;
      if (state.videoW || state.videoH) sizeRef.current = { w: state.videoW, h: state.videoH };
      reportResolution(state.videoW, state.videoH);
      if (state.loaded) setLoading(false);
      if (state.time != null) {
        setCurrentTime(state.time);
        setPlayTime(url, state.time, playbackSource);
        if (!state.error) maybeSkip(state.time, state.duration ?? 0);
      }
      setDuration(state.duration ?? 0);
      setPaused(state.paused);
      setBuffering(state.buffering);
      if (state.cacheTime != null) setBuffered(state.cacheTime);
      if (state.cacheKbps > 0) setNetSpeed(state.cacheKbps);
      if (state.error) {
        clearAuto();
        setMpvError(`视频流无法解析（${state.error}）—可换线路或切回内置内核重试`);
        setLoading(false);
      }
      if (state.eof && !state.error && !eofFired) {
        eofFired = true;
        if (!state.playbackStarted) {
          setMpvError('视频流无法解析（分片读取失败）—— 可换线路或切回内置内核重试');
          setLoading(false);
        } else {
          handlePlaybackEnd();
        }
      }
      if (state.exited) {
        setMpvError(label + '进程已退出（可切回内置内核重试）');
        setLoading(false);
      }
    };

    const common: MpvStartOptions = { url, live: liveHint, startTime: startAt, volume: volumeRef.current, rate, fit, paused: handoffRef.current?.url === url && handoffRef.current.paused };
    const started = engine
      ? client.engineStart?.({ ...common, engineId: kernel }) ?? Promise.reject(new Error('插件内核接口不可用'))
      : client.mpvStart(common).then(result => ({ ok: true, session: result.session, reason: undefined }));
    void started.then(result => {
      if (!alive) return;
      if (!result.ok || !result.session) throw new Error(result.reason || '该内核未能启动');
      sessionRef.current = result.session;
      const earlyEvents = pendingEvents;
      pendingEvents = [];
      for (const event of earlyEvents) pushRef.current?.(event);
      void command({ type: 'volume', value: volumeRef.current }).catch(() => undefined);
      void command({ type: 'rate', value: rate }).catch(() => undefined);
      const spdif = normalizeSpdif(latestOptions.current.spdif);
      if (spdif) void command({ type: 'audio-spdif', value: spdif }).catch(() => undefined);
    }).catch(error => {
      if (!alive) return;
      sessionRef.current = -1;
      pendingEvents = [];
      const reason = error instanceof Error ? error.message : String(error);
      setMpvError(label + '启动失败：' + reason + '（可切回内置内核）');
      setLoading(false);
      if (engine) latestOptions.current.onEngineFailure?.(kernel, reason);
    });

    return () => {
      alive = false;
      pendingEvents = [];
      pushRef.current = null;
      sessionRef.current = -1;
      if (engine) void client.engineStop?.().catch(() => undefined);
      else void client.mpvStop().catch(() => undefined);
    };
    // Keep the existing session boundary: settings and callback changes do not restart a playing MPV process.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowMpv, kernel, url, progressKey, client]);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  const minuteText = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${minuteText}:${String(remainder).padStart(2, '0')}`;
}
