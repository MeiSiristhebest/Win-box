import { describe, expect, it, vi } from 'vitest';
import {
  createHtml5PlaybackTimeline,
  type Html5PlaybackTimelineOptions,
} from '../src/renderer/features/playback/html5PlaybackTimeline';

function makeOptions(overrides: Partial<Html5PlaybackTimelineOptions> = {}) {
  const media: Html5PlaybackTimelineOptions['media'] = { currentTime: 0, duration: 100 };
  const introFired = {
    current: false,
    wasHandled() { return this.current; },
    markHandled() { this.current = true; },
  };
  const outroFired = {
    current: false,
    wasHandled() { return this.current; },
    markHandled() { this.current = true; },
  };
  const setCurrentTime = vi.fn();
  const savePosition = vi.fn();
  const onResumePositionApplied = vi.fn();
  const advance = vi.fn();
  const showToast = vi.fn();
  const options: Html5PlaybackTimelineOptions = {
    media,
    getResumePosition: () => 0,
    getPreRestorePosition: () => 0,
    onResumePositionApplied,
    getSegments: () => ({ intro: 0, outro: 0 }),
    isLive: () => false,
    introFired,
    outroFired,
    setCurrentTime,
    savePosition,
    canAdvance: () => true,
    advance,
    showToast,
    formatTime: (seconds) => `${seconds}s`,
    ...overrides,
  };
  return {
    options,
    media: options.media,
    introFired,
    outroFired,
    setCurrentTime,
    savePosition,
    onResumePositionApplied,
    advance,
    showToast,
  };
}

describe('HTML5 playback timeline', () => {
  it('restores the selected position once when duration is ready', () => {
    const state = makeOptions({ getResumePosition: () => 30 });
    const timeline = createHtml5PlaybackTimeline(state.options);

    timeline.onDurationReady();
    timeline.onDurationReady();

    expect(state.media.currentTime).toBe(30);
    expect(state.onResumePositionApplied).toHaveBeenCalledTimes(1);
  });

  it('retries a resume position when assigning currentTime throws', () => {
    let currentTime = 0;
    let rejectFirstWrite = true;
    const media: Html5PlaybackTimelineOptions['media'] = {
      duration: 100,
      get currentTime() { return currentTime; },
      set currentTime(value: number) {
        if (rejectFirstWrite) {
          rejectFirstWrite = false;
          throw new Error('media is not ready');
        }
        currentTime = value;
      },
    };
    const state = makeOptions({ media, getResumePosition: () => 30 });
    const timeline = createHtml5PlaybackTimeline(state.options);

    timeline.onDurationReady();
    expect(state.onResumePositionApplied).not.toHaveBeenCalled();
    timeline.onDurationReady();

    expect(state.media.currentTime).toBe(30);
    expect(state.onResumePositionApplied).toHaveBeenCalledTimes(1);
  });

  it('marks an intro as passed when resuming after it', () => {
    const state = makeOptions({
      getResumePosition: () => 30,
      getPreRestorePosition: () => 0,
      getSegments: () => ({ intro: 15, outro: 0 }),
    });
    const timeline = createHtml5PlaybackTimeline(state.options);

    timeline.onDurationReady();
    state.media.currentTime = 0;
    timeline.maybeSkip();

    expect(state.introFired.current).toBe(true);
    expect(state.media.currentTime).toBe(0);
    expect(state.showToast).not.toHaveBeenCalled();
  });

  it('skips an intro once and leaves a later manual rewind alone', () => {
    const state = makeOptions({ getSegments: () => ({ intro: 15, outro: 0 }) });
    const timeline = createHtml5PlaybackTimeline(state.options);

    timeline.maybeSkip();
    expect(state.media.currentTime).toBe(15);
    state.media.currentTime = 0;
    timeline.maybeSkip();

    expect(state.media.currentTime).toBe(0);
    expect(state.introFired.current).toBe(true);
    expect(state.setCurrentTime).toHaveBeenCalledTimes(1);
    expect(state.showToast).toHaveBeenCalledTimes(1);
  });

  it('advances for an outro once when another episode is available', () => {
    const state = makeOptions({
      media: { currentTime: 95, duration: 100 },
      getSegments: () => ({ intro: 0, outro: 10 }),
    });
    const timeline = createHtml5PlaybackTimeline(state.options);

    timeline.maybeSkip();
    timeline.maybeSkip();

    expect(state.outroFired.current).toBe(true);
    expect(state.advance).toHaveBeenCalledTimes(1);
    expect(state.showToast).toHaveBeenCalledTimes(1);
  });

  it('does not skip live playback and saves the post-restore time', () => {
    const state = makeOptions({
      getResumePosition: () => 30,
      getSegments: () => ({ intro: 15, outro: 10 }),
      isLive: () => true,
    });
    const timeline = createHtml5PlaybackTimeline(state.options);

    timeline.onTimeUpdate();

    expect(state.media.currentTime).toBe(30);
    expect(state.savePosition).toHaveBeenCalledWith(30);
    expect(state.showToast).not.toHaveBeenCalled();
    expect(state.advance).not.toHaveBeenCalled();
  });
});
