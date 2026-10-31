import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type { MpvAudioTrack, MpvCommand, MpvKernelState, MpvStartOptions, MpvStateEvent } from '../../../shared/player';
import { emptyMpvKernelState, normalizeSpdif } from '../../../shared/player';
import { isEngineKernel, type Kernel } from '../../lib/kernel';
import type { PlaybackSourceRef } from '../../lib/playbackProgress';
import type { PlaybackPositionMemoryPort } from './application/playbackSessionPorts';
import type { PlaybackSessionStatePort } from './application/playbackSessionState';
import { decideMpvSegmentSkip } from './application/mpvSegmentSkipPolicy';
import type { PlayerFit } from './application/playerPreferences';
import { resolveResumePosition, toMpvStartPosition } from './resumePosition';
import type { PlaybackHandoffPort } from './application/playbackHandoff';
import type { PlayerPlaybackPresentationUpdate } from './application/PlayerPlaybackPresentation';
import type { PlaybackKernelSessionPort } from './application/mpvPlaybackPorts';
import { projectMpvPlaybackEvent } from './application/mpvPlaybackEventModel';

export interface PlaybackKernelSessionOptions {
  port: PlaybackKernelSessionPort;
  allowMpv: boolean;
  kernel: Kernel;
  spdif?: string;
  onState?: (state: MpvKernelState) => void;
  onEngineFailure?: (kernel: Kernel, reason: string) => void;
  /** ★ 2026-10-25（自动切源容错机制 AutoChangeParse）：流播放失败/崩溃时回调并自动切线 */
  onPlaybackFailure?: (currentTime: number, reason: string) => void;
  onPlaybackStarted?: () => void;
  url: string;
  progressKey: string;
  playbackSource?: PlaybackSourceRef;
  positionMemory: PlaybackPositionMemoryPort;
  startTime?: number;
  liveHint: boolean;
  rate: number;
  fit: PlayerFit;
  stateRef: MutableRefObject<MpvKernelState>;
  sessionState: PlaybackSessionStatePort;
  timeRef: MutableRefObject<number>;
  sizeRef: MutableRefObject<{ w: number; h: number }>;
  volumeRef: MutableRefObject<number>;
  handoff: PlaybackHandoffPort;
  updatePlaybackStatus(update: PlayerPlaybackPresentationUpdate): void;
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
export function usePlaybackKernelSession(options: PlaybackKernelSessionOptions): void {
  const {
    port,
    allowMpv,
    kernel,
    url,
    progressKey,
    playbackSource,
    positionMemory,
    startTime,
    liveHint,
    rate,
    fit,
    stateRef,
    sessionState,
    timeRef,
    sizeRef,
    volumeRef,
    handoff,
    updatePlaybackStatus,
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
    if (isEngineKernel(kernel)) return port.engineOnState((state) => pushRef.current?.(state));
    if (kernel === 'mpv') return port.mpvOnState((state) => pushRef.current?.(state));
  }, [allowMpv, port, kernel]);

  useEffect(() => {
    if (!allowMpv || kernel === 'html5' || !url) return;
    const engine = isEngineKernel(kernel);
    const label = engine ? '插件内核' : 'MPV 内核';
    const command = (cmd: MpvCommand) => engine ? port.engineCmd(cmd) : port.mpvCmd(cmd);
    let alive = true;
    const handoffTarget = { url, progressKey, kernel } as const;
    const pendingHandoff = handoff.readFor(handoffTarget);
    const saved = resolveResumePosition({
      kernelPosition: pendingHandoff?.position ?? 0,
      startTime,
      storedPosition: positionMemory.read(url, playbackSource),
    });
    if (pendingHandoff) handoff.markPositionApplied(handoffTarget);
    const startAt = toMpvStartPosition(saved);

    updatePlaybackStatus({ error: '', mpvError: '', loading: true, paused: true, currentTime: startAt, duration: 0, buffered: 0, isLive: liveHint, netSpeed: null, relaySpeed: null, buffering: false });
    stateRef.current = emptyMpvKernelState(liveHint);
    sessionState.setLivePlaybackKind(liveHint);
    timeRef.current = startAt;
    sizeRef.current = { w: 0, h: 0 };
    sessionRef.current = 0;

    const skipSegments = sessionState.getSkipSegments();
    let introFired = skipSegments.intro > 0.5 && startAt >= skipSegments.intro;
    let outroFired = false;
    let eofFired = false;
    let pendingEvents: MpvStateEvent[] = [];
    let playbackConfirmed = false;

    const maybeSkip = (time: number, duration: number) => {
      const decision = decideMpvSegmentSkip({
        live: sessionState.getLivePlaybackKind(),
        time,
        duration,
        segments: sessionState.getSkipSegments(),
        introFired,
        outroFired,
      });
      introFired = decision.introFired;
      outroFired = decision.outroFired;
      if (decision.action?.kind === 'seek-intro') {
        seek(decision.action.target);
        showSkipToast(`已跳过片头 ${formatTime(decision.action.target)}`);
        return;
      }
      if (decision.action?.kind === 'outro-threshold-reached') {
        if (canAdvance()) {
          showSkipToast(`已跳过片尾 ${formatTime(decision.action.seconds)}，播放下一集…`);
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
      if (state.playbackStarted && !playbackConfirmed) {
        playbackConfirmed = true;
        latestOptions.current.onPlaybackStarted?.();
      }
      latestOptions.current.onState?.(state);
      audioTracksRef.current?.(state.audioTracks ?? [], state.aid ?? null);
      const plan = projectMpvPlaybackEvent(state, label, eofFired);
      sessionState.setLivePlaybackKind(state.live);
      timeRef.current = plan.currentTime;
      if (plan.size) sizeRef.current = plan.size;
      reportResolution(plan.resolution.width, plan.resolution.height);
      updatePlaybackStatus(plan.presentation);
      if (plan.savePosition != null) positionMemory.save(url, plan.savePosition, playbackSource);
      if (plan.skipAt) maybeSkip(plan.skipAt.time, plan.skipAt.duration);
      if (plan.clearAutoAdvance) clearAuto();
      if (plan.terminalPresentation) {
        updatePlaybackStatus(plan.terminalPresentation);
        if (plan.terminalPresentation.mpvError) {
          latestOptions.current.onPlaybackFailure?.(timeRef.current, String(plan.terminalPresentation.mpvError));
        }
      }
      eofFired = plan.nextEofHandled;
      if (plan.advanceAfterEnd) handlePlaybackEnd();
    };

    const common: MpvStartOptions = { url, live: liveHint, startTime: startAt, volume: volumeRef.current, rate, fit, paused: pendingHandoff?.paused ?? false };
    const started = engine
      ? port.engineStart({ ...common, engineId: kernel })
      : port.mpvStart(common).then(result => ({ ok: true, session: result.session, reason: undefined }));
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
      updatePlaybackStatus({ mpvError: label + '启动失败：' + reason + '（可切回内置内核）', loading: false });
      latestOptions.current.onPlaybackFailure?.(timeRef.current, reason);
      if (engine) latestOptions.current.onEngineFailure?.(kernel, reason);
    });

    return () => {
      alive = false;
      pendingEvents = [];
      pushRef.current = null;
      sessionRef.current = -1;
      if (engine) void port.engineStop().catch(() => undefined);
      else void port.mpvStop().catch(() => undefined);
    };
    // Keep the existing session boundary: settings and callback changes do not restart a playing MPV process.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowMpv, kernel, url, progressKey, port, positionMemory]);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  const minuteText = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${minuteText}:${String(remainder).padStart(2, '0')}`;
}
