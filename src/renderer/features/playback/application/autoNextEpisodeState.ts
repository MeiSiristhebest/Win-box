export interface AutoNextEpisodeState {
  nextCount: number | null;
  endAll: boolean;
}

export type AutoNextEpisodeEvent =
  | { type: 'playback-ended'; canAdvance: boolean; immediate: boolean }
  | { type: 'start-countdown' }
  | { type: 'countdown-tick' }
  | { type: 'clear' }
  | { type: 'cancel-countdown'; isPaused: boolean };

export type AutoNextEpisodeEffect = 'clear-timer' | 'schedule-countdown' | 'advance' | 'pause';

export interface AutoNextEpisodeTransition {
  state: AutoNextEpisodeState;
  effects: AutoNextEpisodeEffect[];
}

export const EMPTY_AUTO_NEXT_EPISODE_STATE: AutoNextEpisodeState = { nextCount: null, endAll: false };

/** Pure countdown and playback-end policy. Timer and navigation I/O stay in the hook adapter. */
export function transitionAutoNextEpisode(
  state: AutoNextEpisodeState,
  event: AutoNextEpisodeEvent,
): AutoNextEpisodeTransition {
  switch (event.type) {
    case 'playback-ended':
      if (!event.canAdvance) {
        return { state: { nextCount: null, endAll: true }, effects: ['clear-timer'] };
      }
      if (event.immediate) {
        return { state: EMPTY_AUTO_NEXT_EPISODE_STATE, effects: ['clear-timer', 'advance'] };
      }
      return { state: { nextCount: 5, endAll: false }, effects: ['clear-timer', 'schedule-countdown'] };

    case 'start-countdown':
      return { state: { nextCount: 5, endAll: false }, effects: ['clear-timer', 'schedule-countdown'] };

    case 'countdown-tick':
      if (state.nextCount === null) return { state, effects: [] };
      if (state.nextCount <= 1) {
        return { state: EMPTY_AUTO_NEXT_EPISODE_STATE, effects: ['clear-timer', 'advance'] };
      }
      return { state: { nextCount: state.nextCount - 1, endAll: false }, effects: [] };

    case 'cancel-countdown':
      return {
        state: EMPTY_AUTO_NEXT_EPISODE_STATE,
        effects: event.isPaused ? ['clear-timer'] : ['clear-timer', 'pause'],
      };

    case 'clear':
      return { state: EMPTY_AUTO_NEXT_EPISODE_STATE, effects: ['clear-timer'] };
  }
}
