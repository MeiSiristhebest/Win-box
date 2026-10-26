import { shouldSkipIntro, shouldSkipOutro, type SkipSeg } from './application/skipSegments';
import { canRestoreHtml5Position } from './resumePosition';

interface SkipHandledState {
  wasHandled(): boolean;
  markHandled(): void;
}

export interface Html5PlaybackTimelineOptions {
  media: Pick<HTMLVideoElement, 'currentTime' | 'duration'>;
  getResumePosition: () => number;
  getPreRestorePosition: () => number;
  onResumePositionApplied: () => void;
  getSegments: () => SkipSeg;
  isLive: () => boolean;
  introFired: SkipHandledState;
  outroFired: SkipHandledState;
  setCurrentTime: (time: number) => void;
  savePosition: (time: number) => void;
  canAdvance: () => boolean;
  advance: () => void;
  showToast: (message: string) => void;
  formatTime: (seconds: number) => string;
}

export interface Html5PlaybackTimeline {
  onTimeUpdate: () => void;
  onDurationReady: () => void;
  maybeSkip: () => void;
}

export function createHtml5PlaybackTimeline(
  options: Html5PlaybackTimelineOptions,
): Html5PlaybackTimeline {
  let restored = false;

  const tryRestore = () => {
    if (restored) return;
    const saved = options.getResumePosition();
    if (canRestoreHtml5Position(saved, options.media.duration)) {
      try {
        options.media.currentTime = saved;
        restored = true;
        const intro = options.getSegments().intro;
        if (intro > 0.5 && saved >= intro) options.introFired.markHandled();
        options.onResumePositionApplied();
      } catch {
        /* ignore */
      }
    }
  };

  const maybeSkip = () => {
    if (options.isLive()) return;
    const segments = options.getSegments();
    if (!segments.intro && !segments.outro) return;
    const duration = Number.isFinite(options.media.duration) ? options.media.duration : 0;

    if (segments.intro > 0.5) {
      if (!restored && options.getPreRestorePosition() >= segments.intro) {
        options.introFired.markHandled();
      }
      if (shouldSkipIntro(options.media.currentTime, duration, segments, options.introFired.wasHandled())) {
        options.introFired.markHandled();
        try {
          options.media.currentTime = segments.intro;
        } catch {
          /* ignore */
        }
        options.setCurrentTime(segments.intro);
        options.showToast(`已跳过片头 ${options.formatTime(segments.intro)}`);
        return;
      }
    }

    if (shouldSkipOutro(options.media.currentTime, duration, segments, options.outroFired.wasHandled())) {
      options.outroFired.markHandled();
      if (options.canAdvance()) {
        options.showToast(`已跳过片尾 ${options.formatTime(segments.outro)}，播放下一集…`);
        options.advance();
      }
    }
  };

  return {
    onTimeUpdate: () => {
      options.setCurrentTime(options.media.currentTime);
      tryRestore();
      maybeSkip();
      options.savePosition(options.media.currentTime);
    },
    onDurationReady: () => {
      tryRestore();
      maybeSkip();
    },
    maybeSkip,
  };
}
