import { describe, expect, it } from 'vitest';
import {
  EMPTY_AUTO_NEXT_EPISODE_STATE,
  transitionAutoNextEpisode,
} from '../src/renderer/features/playback/application/autoNextEpisodeState';

describe('auto-next episode state policy', () => {
  it('starts a cancellable five-second countdown when a next episode is available', () => {
    expect(transitionAutoNextEpisode(EMPTY_AUTO_NEXT_EPISODE_STATE, {
      type: 'playback-ended', canAdvance: true, immediate: false,
    })).toEqual({
      state: { nextCount: 5, endAll: false },
      effects: ['clear-timer', 'schedule-countdown'],
    });
  });

  it('advances after the final tick and reports when no episodes remain', () => {
    expect(transitionAutoNextEpisode({ nextCount: 1, endAll: false }, { type: 'countdown-tick' })).toEqual({
      state: EMPTY_AUTO_NEXT_EPISODE_STATE,
      effects: ['clear-timer', 'advance'],
    });
    expect(transitionAutoNextEpisode(EMPTY_AUTO_NEXT_EPISODE_STATE, {
      type: 'playback-ended', canAdvance: false, immediate: false,
    })).toEqual({ state: { nextCount: null, endAll: true }, effects: ['clear-timer'] });
  });

  it('cancels the timer and pauses only when playback is still active', () => {
    expect(transitionAutoNextEpisode({ nextCount: 4, endAll: false }, {
      type: 'cancel-countdown', isPaused: false,
    })).toEqual({ state: EMPTY_AUTO_NEXT_EPISODE_STATE, effects: ['clear-timer', 'pause'] });
    expect(transitionAutoNextEpisode({ nextCount: 4, endAll: false }, {
      type: 'cancel-countdown', isPaused: true,
    })).toEqual({ state: EMPTY_AUTO_NEXT_EPISODE_STATE, effects: ['clear-timer'] });
  });
});
