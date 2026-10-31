import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type HlsInstance from 'hls.js';
import type MpegtsModule from 'mpegts.js';
import type { Kernel } from '../../lib/kernel';
import type { PlaybackSourceRef } from '../../lib/playbackProgress';
import { resolvePlayTarget } from '../../lib/playTarget';
import { detectMediaKind } from '../../lib/mediaKind';
import type { PlayerPrefs } from './application/playerPreferences';
import type { PlaybackPositionMemoryPort, PlaybackRuntimePort } from './application/playbackSessionPorts';
import type { PlaybackSessionStatePort } from './application/playbackSessionState';
import { resolveResumePosition } from './resumePosition';
import { createHtml5PlaybackTimeline } from './html5PlaybackTimeline';
import { hlsErrorText } from './hlsErrorText';
import { createHtml5PlaybackRecovery, type Html5HlsFailureType } from './application/html5PlaybackRecovery';
import { reportHtmlMediaEvent, type MediaDiagnosticsPort } from './application/mediaDiagnostics';
import type { PlaybackHandoffPort } from './application/playbackHandoff';
import type { PlayerPlaybackPresentationUpdate } from './application/PlayerPlaybackPresentation';
import type { AdaptiveAudioTrackController } from './application/playerAudioTracks';
import { createHlsAudioTrackControllerAdapter } from './adapters/hlsAudioTrackControllerAdapter';

export interface Html5PlaybackSessionOptions {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  adaptiveAudioTracksRef?: MutableRefObject<AdaptiveAudioTrackController | null>;
  resourceName?: string;
  onAudioTracks?: () => void;
  url: string;
  htmlUrl: string;
  progressKey: string;
  kernel: Kernel;
  isImage: boolean;
  isAudio: boolean;
  liveHint: boolean;
  playbackSource?: PlaybackSourceRef;
  positionMemory: PlaybackPositionMemoryPort;
  runtime: PlaybackRuntimePort;
  startTime?: number;
  prefsRef: MutableRefObject<PlayerPrefs | null>;
  bossActiveRef: MutableRefObject<boolean>;
  sessionState: PlaybackSessionStatePort;
  handoff: PlaybackHandoffPort;
  updatePlaybackStatus(update: PlayerPlaybackPresentationUpdate): void;
  clearAuto(): void;
  revealControls(): void;
  recoverHtmlPlayback(): boolean;
  onPlaybackFailure?(currentTime: number, reason: string): void;
  tryExternalFallback?(sourceUrl: string, position: number): Promise<{ opened: boolean; player?: string; error?: string } | null>;
  handlePlaybackEnd(): void;
  canAdvance(): boolean;
  advance(): void;
  showSkipToast(message: string): void;
  formatTime(seconds: number): string;
}

/** Owns the HTML media element, HLS/FLV engines, event listeners and their cleanup. */
export function useHtml5PlaybackSession(options: Html5PlaybackSessionOptions, mediaDiagnostics: MediaDiagnosticsPort): void {
  const hlsInstanceRef = useRef<HlsInstance | null>(null);
  const localAdaptiveAudioTracksRef = useRef<AdaptiveAudioTrackController | null>(null);
  const adaptiveAudioTracksRef = options.adaptiveAudioTracksRef ?? localAdaptiveAudioTracksRef;
  const audioTracksRef = useRef(options.onAudioTracks);
  useLayoutEffect(() => { audioTracksRef.current = options.onAudioTracks; }, [options.onAudioTracks]);
  const {
    videoRef,
    url,
    htmlUrl,
    progressKey,
    kernel,
    isImage,
    isAudio,
    liveHint,
    playbackSource,
    positionMemory,
    runtime,
    startTime,
    prefsRef,
    bossActiveRef,
    sessionState,
    handoff,
    updatePlaybackStatus,
    clearAuto,
    revealControls,
    recoverHtmlPlayback,
    onPlaybackFailure,
    tryExternalFallback,
    handlePlaybackEnd,
    canAdvance,
    advance,
    showSkipToast,
    formatTime,
  } = options;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !htmlUrl || isImage || isAudio || kernel !== 'html5') return;

    updatePlaybackStatus({ error: '', mpvError: '', loading: true, paused: true, currentTime: 0, duration: 0, isLive: liveHint });
    sessionState.setLivePlaybackKind(liveHint);
    updatePlaybackStatus({ netSpeed: null, relaySpeed: null, buffering: false });

    if (prefsRef.current) {
      video.volume = prefsRef.current.vol;
      video.playbackRate = prefsRef.current.rate;
    }
    video.removeAttribute('src');
    hlsInstanceRef.current?.destroy();
    hlsInstanceRef.current = null;
    adaptiveAudioTracksRef.current = null;
    const oldFlv = (video as unknown as { __flv?: MpegtsModule.Player }).__flv;
    if (oldFlv) {
      try {
        oldFlv.destroy();
      } catch {
        /* Ignore an engine teardown failure. */
      }
    }
    (video as unknown as { __flv?: MpegtsModule.Player }).__flv = undefined;

    const target = resolvePlayTarget(htmlUrl).toLowerCase().split('?')[0];
    let speedTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let terminalFailureReported = false;
    const recovery = createHtml5PlaybackRecovery();
    const reportTerminalFailure = (message: string, reason: string) => {
      if (terminalFailureReported || cancelled) return;
      terminalFailureReported = true;
      updatePlaybackStatus({ error: message, loading: false });
      onPlaybackFailure?.(Math.max(0, video.currentTime || 0), reason);
    };
    let previousBytes = -1;
    let previousTime = 0;
    const reportKiloBytesPerSecond = (speed: number) => {
      if (Number.isFinite(speed) && speed > 0) updatePlaybackStatus({ netSpeed: speed });
    };
    const handoffTarget = { url, progressKey, kernel } as const;
    const currentHandoff = () => handoff.readFor(handoffTarget);
    const timeline = createHtml5PlaybackTimeline({
      media: video,
      getResumePosition: () => resolveResumePosition({
        kernelPosition: currentHandoff()?.position ?? 0,
        startTime,
        storedPosition: positionMemory.read(url, playbackSource),
      }),
      getPreRestorePosition: () => resolveResumePosition({
        kernelPosition: 0,
        startTime,
        storedPosition: positionMemory.read(url, playbackSource),
      }),
      onResumePositionApplied: () => {
        handoff.markPositionApplied(handoffTarget);
      },
      getSegments: () => sessionState.getSkipSegments(),
      isLive: () => sessionState.getLivePlaybackKind(),
      introFired: {
        wasHandled: sessionState.wasIntroSkipHandled,
        markHandled: sessionState.markIntroSkipHandled,
      },
      outroFired: {
        wasHandled: sessionState.wasOutroSkipHandled,
        markHandled: sessionState.markOutroSkipHandled,
      },
      setCurrentTime: (value) => updatePlaybackStatus({ currentTime: value }),
      savePosition: (time) => positionMemory.save(url, time, playbackSource),
      canAdvance,
      advance,
      showToast: showSkipToast,
      formatTime,
    });
    const onTime = timeline.onTimeUpdate;
    const onCanPlay = () => {
      if (!bossActiveRef.current && prefsRef.current) {
        if (video.volume !== prefsRef.current.vol) video.volume = prefsRef.current.vol;
        if (video.playbackRate !== prefsRef.current.rate) video.playbackRate = prefsRef.current.rate;
      }
       updatePlaybackStatus({ loading: false });
      timeline.maybeSkip();
    };
    const onDuration = () => {
      const duration = video.duration;
      updatePlaybackStatus({ duration: Number.isFinite(duration) ? duration : 0, isLive: sessionState.getLivePlaybackKind() || duration === Infinity });
      timeline.onDurationReady();
    };
    const onPlay = () => {
      updatePlaybackStatus({ paused: false, buffering: false });
      clearAuto();
      revealControls();
    };
    const onPause = () => {
      updatePlaybackStatus({ paused: true });
      revealControls();
    };
    const onWaiting = () => updatePlaybackStatus({ buffering: true });
    const onPlaying = () => updatePlaybackStatus({ buffering: false });
    const onError = () => {
      const mediaError = video.error;
      if (recovery.shouldIgnoreMediaError(mediaError?.code ?? 0)) return;
      const decision = recovery.onMediaError({
        code: mediaError?.code ?? 0,
        kernelRecoveryStarted: recoverHtmlPlayback(),
        externalFallbackAvailable: !!tryExternalFallback,
      });
      if (decision.kind === 'ignore') return;
      const reason = mediaError?.code === 2
        ? '网络读取失败，源站可能拒绝连接或链接已失效'
        : mediaError?.code === 3
          ? '视频解码失败，可能是编码不兼容或媒体数据损坏'
          : mediaError?.code === 4
            ? '内置播放器无法识别该媒体响应：可能是源站返回了网页/文字，也可能是编码或播放清单不受当前内核支持'
            : mediaError?.code === 1
              ? '播放请求已中止'
              : '视频加载失败或源不可用';
      const nativeMessage = mediaError?.message?.replace(/\s+/g, ' ').trim().slice(0, 160);
      const redundantFormatCode = mediaError?.code === 4 && /MEDIA_ELEMENT_ERROR:\\s*Format error/i.test(nativeMessage || '');
      const errorMessage = `播放出错：${reason}${nativeMessage && !redundantFormatCode ? `（技术信息：${nativeMessage}）` : ''}`;
      updatePlaybackStatus({ loading: false });
      // When the user has explicitly enabled an external player, hand formats
      // Chromium cannot demux (for example HEVC/MKV or a source-specific stream)
      // to that player using the same local proxy URL and current seek position.
      // A single attempt per media session avoids duplicate launches from repeated
      // Chromium error events.
      if (decision.kind === 'try-external-player' && tryExternalFallback) {
        void tryExternalFallback(htmlUrl || url, Math.max(0, video.currentTime || 0)).then((result) => {
          const completion = recovery.completeExternalFallback(result);
          if (completion.kind === 'ignore') return;
          if (completion.kind === 'external-player-opened') {
          updatePlaybackStatus({ error: `内置播放器无法解析此媒体，已启动${completion.player || '外部播放器'}；请在播放器窗口确认播放状态。` });
            return;
          }
          const message = completion.error ? `${errorMessage}（外部播放器启动失败：${completion.error}）` : errorMessage;
          reportTerminalFailure(message, completion.error || nativeMessage || reason);
        }).catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          const completion = recovery.completeExternalFallback({ opened: false, error: detail });
          if (completion.kind === 'ignore') return;
          reportTerminalFailure(`${errorMessage}（外部播放器启动失败：${detail}）`, detail);
        });
        return;
      }
      reportTerminalFailure(errorMessage, nativeMessage || reason);
    };
    const onEnded = () => handlePlaybackEnd();

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    video.addEventListener('ended', onEnded);

    const start = () => {
      if (currentHandoff()?.paused) {
        updatePlaybackStatus({ paused: true });
        return;
      }
      video.play().then(() => updatePlaybackStatus({ paused: false })).catch(() => undefined);
    };

    if (detectMediaKind(htmlUrl) === 'hls') {
      // Electron/Chromium may report "maybe" for Apple's HLS MIME type even
      // though its media pipeline cannot demux HLS. In the desktop app, always
      // let hls.js load manifests and segments through the supported MSE path.
      const desktopRuntime = runtime.isDesktopRuntime();
      if (!desktopRuntime && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = htmlUrl;
        start();
      } else {
        void import('hls.js').then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
        updatePlaybackStatus({ error: '当前环境不支持 HLS 播放', loading: false });
            return;
          }
          const hls = new Hls({
          maxBufferLength: 20,
          maxMaxBufferLength: 60,
          maxBufferSize: 30 * 1000 * 1000,
          backBufferLength: 30,
            enableWorker: true,
            manifestLoadingTimeOut: 180000,
            levelLoadingTimeOut: 180000,
            fragLoadingTimeOut: 180000,
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 800,
            levelLoadingMaxRetry: 4,
            fragLoadingMaxRetry: 4,
            fragLoadingRetryDelay: 800,
          });
          hlsInstanceRef.current = hls;
          const audioTrackController = createHlsAudioTrackControllerAdapter(hls);
          adaptiveAudioTracksRef.current = audioTrackController;
          hls.loadSource(htmlUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => { start(); audioTracksRef.current?.(); });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => audioTracksRef.current?.());
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => audioTracksRef.current?.());
          hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
            const details = (data as unknown as { details?: { live?: boolean } }).details;
            const live = !!details?.live;
            sessionState.setLivePlaybackKind(live);
            updatePlaybackStatus({ isLive: live });
          });
          hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
            const stats = (data as { stats?: { loading: number; loaded: number } }).stats;
            if (stats && stats.loading > 0) {
              reportKiloBytesPerSecond(stats.loaded / 1024 / (stats.loading / 1000));
            }
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || !recovery.isActive()) return;
            const responseStatus = data.response?.code;
            const errorType: Html5HlsFailureType = data.type === Hls.ErrorTypes.NETWORK_ERROR
              ? 'network'
              : data.type === Hls.ErrorTypes.MEDIA_ERROR
                ? 'media'
                : 'other';
            const decision = recovery.onHlsFatal({ type: errorType, responseStatus });
            if (decision.kind === 'ignore') return;
            reportHtmlMediaEvent(mediaDiagnostics, {
              event: 'hls-fatal:' + data.type + ':' + data.details,
              url: htmlUrl,
              title: options.resourceName,
              readyState: video.readyState,
              currentTime: video.currentTime,
              paused: video.paused,
            });
            if (decision.kind === 'retry-network') {
              updatePlaybackStatus({ error: '' });
              try { hls.startLoad(); } catch { /* Ignore a failed retry request. */ }
              return;
            }
            if (decision.kind === 'recover-media') {
              updatePlaybackStatus({ error: '' });
              try { hls.recoverMediaError(); } catch { /* Ignore a failed recovery request. */ }
              return;
            }
            if (decision.kind === 'switch-kernel' && recoverHtmlPlayback()) return;
            const retries = decision.retryCount ?? 0;
            const reason = hlsErrorText(data.type, data.details, responseStatus, data.response?.data);
            reportTerminalFailure(`HLS 播放失败：${reason}` + (retries ? `（已自动重试 ${retries} 次）` : ''), reason);
          });
        }).catch(() => {
          if (cancelled) return;
          if (recoverHtmlPlayback()) return;
          reportTerminalFailure('HLS 播放组件加载失败', 'hls-component-load');
        });
      }
    } else if (target.endsWith('.flv') || target.endsWith('.ts') || /mpegts/.test(target)) {
      void import('mpegts.js').then(({ default: mpegts }) => {
        if (cancelled) return;
        if (!mpegts.isSupported()) {
          if (recoverHtmlPlayback()) return;
          reportTerminalFailure('当前环境不支持 FLV 播放', 'mpegts-unsupported');
          return;
        }
        const isFlv = target.endsWith('.flv') || /mpegts/.test(target);
        const player = mpegts.createPlayer({
          type: isFlv ? 'flv' : 'mpegts',
          url: htmlUrl,
          isLive: isFlv || /live/i.test(target),
        });
        (video as unknown as { __flv?: MpegtsModule.Player }).__flv = player;
        player.attachMediaElement(video);
        player.load();
        player.on(mpegts.Events.STATISTICS_INFO, (info: { currentSpeed?: number }) => {
          if (info?.currentSpeed != null && info.currentSpeed > 0) reportKiloBytesPerSecond(info.currentSpeed);
        });
        player.on(mpegts.Events.ERROR, (type: string, detail: string, info: unknown) => {
          if (cancelled || recoverHtmlPlayback()) return;
          const reason = [type, detail, typeof info === 'string' ? info : ''].filter(Boolean).join(': ').slice(0, 180);
          reportTerminalFailure(`MPEG-TS 播放失败：${reason || '媒体流读取或解复用失败'}`, reason || 'mpegts-error');
        });
        const keepPaused = currentHandoff()?.paused;
        if (keepPaused) {
          updatePlaybackStatus({ paused: true });
        } else {
          try { player.play(); } catch { /* Ignore autoplay refusal. */ }
          updatePlaybackStatus({ paused: false });
        }
      }).catch(() => {
        if (cancelled) return;
        if (recoverHtmlPlayback()) return;
        reportTerminalFailure('MPEG-TS 播放组件加载失败', 'mpegts-component-load');
      });
    } else {
      const targetPrefix = url.split('?')[0];
      speedTimer = setInterval(() => {
        let bytes = 0;
        try {
          for (const entry of performance.getEntriesByType('resource')) {
            const resource = entry as PerformanceResourceTiming;
            if (!resource?.name) continue;
            if (resource.name !== url && !resource.name.startsWith(targetPrefix)) continue;
            const transferred = Number.isFinite(resource.transferSize) && resource.transferSize > 0
              ? resource.transferSize
              : Number.isFinite(resource.encodedBodySize) && resource.encodedBodySize > 0
                ? resource.encodedBodySize
                : 0;
            bytes += transferred;
          }
        } catch {
          /* Resource Timing may be unavailable for a media URL. */
        }
        if (bytes > 0 && bytes !== previousBytes) {
          const now = performance.now();
          if (previousBytes >= 0 && previousTime > 0) {
            const elapsedSeconds = (now - previousTime) / 1000;
            const speed = (bytes - previousBytes) / 1024 / (elapsedSeconds > 0 ? elapsedSeconds : 1);
            if (speed > 0 && speed < 1024 * 1024) reportKiloBytesPerSecond(speed);
          }
          previousBytes = bytes;
          previousTime = now;
        }
      }, 600);
      video.src = htmlUrl;
      start();
    }

    return () => {
      cancelled = true;
      recovery.cancel();
      if (speedTimer) clearInterval(speedTimer);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video.removeEventListener('ended', onEnded);
      clearAuto();
      if (!video.paused) positionMemory.save(url, video.currentTime, playbackSource);
      video.pause();
      const hlsInstance = hlsInstanceRef.current;
      hlsInstanceRef.current = null;
      if (hlsInstance) {
        if (adaptiveAudioTracksRef.current) adaptiveAudioTracksRef.current = null;
        hlsInstance.destroy();
      }
      const flv = (video as unknown as { __flv?: MpegtsModule.Player }).__flv;
      if (flv) {
        try { flv.destroy(); } catch { /* Ignore an engine teardown failure. */ }
      }
      (video as unknown as { __flv?: MpegtsModule.Player }).__flv = undefined;
      video.removeAttribute('src');
      video.load();
    };
    // Keep the existing session boundary: URL, kernel, prepared URL, and playback source changes restart the HTML5 session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, kernel, htmlUrl, progressKey, positionMemory, runtime]);
}
