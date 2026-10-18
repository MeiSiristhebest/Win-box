import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type HlsInstance from 'hls.js';
import type MpegtsModule from 'mpegts.js';
import type { Kernel } from '../../lib/kernel';
import type { PlaybackSourceRef } from '../../lib/playbackProgress';
import { resolvePlayTarget } from '../../lib/playTarget';
import { detectMediaKind } from '../../lib/mediaKind';
import type { PlayerPrefs } from '../../lib/playerPrefs';
import { getPlayTime, setPlayTime } from '../../lib/uiMemory';
import type { SkipSeg } from '../../lib/skipSegments';
import { resolveResumePosition } from './resumePosition';
import { createHtml5PlaybackTimeline } from './html5PlaybackTimeline';
import { hlsErrorText } from './hlsErrorText';
import { reportHtmlMediaEvent } from './useMediaDiagnostics';

export interface Html5PlaybackSessionOptions {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  hlsRef?: MutableRefObject<HlsInstance | null>;
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
  startTime?: number;
  prefsRef: MutableRefObject<PlayerPrefs | null>;
  bossActiveRef: MutableRefObject<boolean>;
  liveKindRef: MutableRefObject<boolean>;
  resumeRef: MutableRefObject<number>;
  volumeHandoffRef: MutableRefObject<{ url: string; paused: boolean } | null>;
  skipSegmentsRef: MutableRefObject<SkipSeg>;
  introFiredRef: MutableRefObject<boolean>;
  outroFiredRef: MutableRefObject<boolean>;
  setError(value: string): void;
  setMpvError(value: string): void;
  setLoading(value: boolean): void;
  setPaused(value: boolean): void;
  setCurrentTime(value: number): void;
  setDuration(value: number): void;
  setIsLive(value: boolean): void;
  setNetSpeed(value: number | null): void;
  setRelaySpeed(value: number | null): void;
  setBuffering(value: boolean): void;
  clearAuto(): void;
  revealControls(): void;
  tryMpvFallback(): boolean;
  handlePlaybackEnd(): void;
  canAdvance(): boolean;
  advance(): void;
  showSkipToast(message: string): void;
  formatTime(seconds: number): string;
}

/** Owns the HTML media element, HLS/FLV engines, event listeners and their cleanup. */
export function useHtml5PlaybackSession(options: Html5PlaybackSessionOptions): void {
  const localHlsRef = useRef<HlsInstance | null>(null);
  const hlsRef = options.hlsRef ?? localHlsRef;
  const audioTracksRef = useRef(options.onAudioTracks);
  useLayoutEffect(() => { audioTracksRef.current = options.onAudioTracks; }, [options.onAudioTracks]);
  const hlsNetRetryRef = useRef(0);
  const hlsMediaRetryRef = useRef(0);
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
    startTime,
    prefsRef,
    bossActiveRef,
    liveKindRef,
    resumeRef,
    volumeHandoffRef,
    skipSegmentsRef,
    introFiredRef,
    outroFiredRef,
    setError,
    setMpvError,
    setLoading,
    setPaused,
    setCurrentTime,
    setDuration,
    setIsLive,
    setNetSpeed,
    setRelaySpeed,
    setBuffering,
    clearAuto,
    revealControls,
    tryMpvFallback,
    handlePlaybackEnd,
    canAdvance,
    advance,
    showSkipToast,
    formatTime,
  } = options;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !htmlUrl || isImage || isAudio || kernel === 'mpv') return;

    setError('');
    setMpvError('');
    setLoading(true);
    setPaused(true);
    setCurrentTime(0);
    setDuration(0);
    setIsLive(liveHint);
    liveKindRef.current = liveHint;
    setNetSpeed(null);
    setRelaySpeed(null);
    setBuffering(false);

    if (prefsRef.current) {
      video.volume = prefsRef.current.vol;
      video.playbackRate = prefsRef.current.rate;
    }
    video.src = '';
    hlsRef.current?.destroy();
    hlsRef.current = null;
    hlsNetRetryRef.current = 0;
    hlsMediaRetryRef.current = 0;
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
    let previousBytes = -1;
    let previousTime = 0;
    const reportKiloBytesPerSecond = (speed: number) => {
      if (Number.isFinite(speed) && speed > 0) setNetSpeed(speed);
    };
    const timeline = createHtml5PlaybackTimeline({
      media: video,
      getResumePosition: () => resolveResumePosition({
        kernelPosition: resumeRef.current,
        startTime,
        storedPosition: getPlayTime(url, playbackSource),
      }),
      getPreRestorePosition: () => resolveResumePosition({
        kernelPosition: 0,
        startTime,
        storedPosition: getPlayTime(url, playbackSource),
      }),
      onResumePositionApplied: () => { resumeRef.current = 0; },
      getSegments: () => skipSegmentsRef.current,
      isLive: () => liveKindRef.current,
      introFired: introFiredRef,
      outroFired: outroFiredRef,
      setCurrentTime,
      savePosition: (time) => setPlayTime(url, time, playbackSource),
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
      setLoading(false);
      timeline.maybeSkip();
    };
    const onDuration = () => {
      const duration = video.duration;
      setDuration(Number.isFinite(duration) ? duration : 0);
      setIsLive(liveKindRef.current || duration === Infinity);
      timeline.onDurationReady();
    };
    const onPlay = () => {
      setPaused(false);
      setBuffering(false);
      clearAuto();
      revealControls();
    };
    const onPause = () => {
      setPaused(true);
      revealControls();
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onError = () => {
      if (tryMpvFallback()) return;
      setError('播放出错：视频加载失败或源不可用');
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
      if (volumeHandoffRef.current?.url === url && volumeHandoffRef.current.paused) {
        setPaused(true);
        return;
      }
      video.play().then(() => setPaused(false)).catch(() => undefined);
    };

    if (detectMediaKind(htmlUrl) === 'hls') {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = htmlUrl;
        start();
      } else {
        void import('hls.js').then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setError('当前环境不支持 HLS 播放');
            setLoading(false);
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
          hlsRef.current = hls;
          hls.loadSource(htmlUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => { start(); audioTracksRef.current?.(); });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => audioTracksRef.current?.());
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => audioTracksRef.current?.());
          hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
            const details = (data as unknown as { details?: { live?: boolean } }).details;
            const live = !!details?.live;
            liveKindRef.current = live;
            setIsLive(live);
          });
          hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
            const stats = (data as { stats?: { loading: number; loaded: number } }).stats;
            if (stats && stats.loading > 0) {
              reportKiloBytesPerSecond(stats.loaded / 1024 / (stats.loading / 1000));
            }
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            reportHtmlMediaEvent(video, htmlUrl, options.resourceName, 'hls-fatal:' + data.type + ':' + data.details);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hlsNetRetryRef.current < 2) {
              hlsNetRetryRef.current++;
              setError('');
              try { hls.startLoad(); } catch { /* Ignore a failed retry request. */ }
              return;
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsMediaRetryRef.current < 2) {
              hlsMediaRetryRef.current++;
              setError('');
              try { hls.recoverMediaError(); } catch { /* Ignore a failed recovery request. */ }
              return;
            }
            const retries = hlsNetRetryRef.current + hlsMediaRetryRef.current;
            if (tryMpvFallback()) return;
            setError(`HLS 播放失败：${hlsErrorText(data.type, data.details)}` + (retries ? `（已自动重试 ${retries} 次）` : ''));
          });
        }).catch(() => {
          if (cancelled) return;
          setError('HLS 播放组件加载失败');
          setLoading(false);
        });
      }
    } else if (target.endsWith('.flv') || target.endsWith('.ts') || /mpegts/.test(target)) {
      void import('mpegts.js').then(({ default: mpegts }) => {
        if (cancelled) return;
        if (!mpegts.isSupported()) {
          setError('当前环境不支持 FLV 播放');
          setLoading(false);
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
        const keepPaused = volumeHandoffRef.current?.url === url && volumeHandoffRef.current.paused;
        if (keepPaused) {
          setPaused(true);
        } else {
          try { player.play(); } catch { /* Ignore autoplay refusal. */ }
          setPaused(false);
        }
      }).catch(() => {
        if (cancelled) return;
        setError('MPEG-TS 播放组件加载失败');
        setLoading(false);
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
      if (!video.paused) setPlayTime(url, video.currentTime, playbackSource);
      video.pause();
      hlsRef.current?.destroy();
      hlsRef.current = null;
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
  }, [url, kernel, htmlUrl, progressKey]);
}
