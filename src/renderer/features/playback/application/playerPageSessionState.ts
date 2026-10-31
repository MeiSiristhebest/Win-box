import type { PlayerInitData } from './playerPageSession';

export type PlayerSourceFallbackState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'switching'; sourceName: string }
  | { kind: 'choices'; candidates: Array<{ id: string; sourceName: string; profileName: string }>; incompleteSources: number; truncated: boolean }
  | { kind: 'unavailable'; message: string };

export type PlayerPageResolutionState =
  | { kind: 'idle' }
  | { kind: 'hydrating' }
  | { kind: 'resolving' }
  | { kind: 'ready'; url: string; parseName?: string }
  | { kind: 'drive-bind-required'; provider: string }
  | { kind: 'failed'; message: string };

export interface PlayerPageSessionState {
  init: PlayerInitData | null;
  epIndex: number;
  curName: string;
  playName: string;
  resolution: PlayerPageResolutionState;
  sourceFallback: PlayerSourceFallbackState;
}

export type PlayerPageSessionAction =
  | { type: 'hydration-started' }
  | { type: 'hydration-completed'; init: PlayerInitData; epIndex: number }
  | { type: 'hydration-failed'; message: string }
  | { type: 'init-updated'; init: PlayerInitData }
  | { type: 'resolution-started'; epIndex: number; curName: string; playName: string }
  | { type: 'resolution-succeeded'; url: string; parseName?: string }
  | { type: 'drive-bind-required'; provider: string }
  | { type: 'resolution-failed'; message: string }
  | { type: 'source-fallback-searching' }
  | { type: 'source-fallback-switching'; sourceName: string }
  | { type: 'source-fallback-choices'; candidates: Array<{ id: string; sourceName: string; profileName: string }>; incompleteSources: number; truncated: boolean }
  | { type: 'source-fallback-unavailable'; message: string }
  | { type: 'source-fallback-cleared' }
  | { type: 'drive-bind-dismissed' };

export interface PlayerPageSessionPresentation {
  init: PlayerInitData | null;
  epIndex: number;
  activeUrl: string;
  curName: string;
  playName: string;
  resolving: boolean;
  driveBind: string | null;
  parseMsg: string;
  parseName?: string;
  sourceFallback: PlayerSourceFallbackState;
}

export const initialPlayerPageSessionState: PlayerPageSessionState = {
  init: null,
  epIndex: 0,
  curName: '',
  playName: '',
  resolution: { kind: 'idle' },
  sourceFallback: { kind: 'idle' },
};

export function reducePlayerPageSession(
  state: PlayerPageSessionState,
  action: PlayerPageSessionAction,
): PlayerPageSessionState {
  switch (action.type) {
    case 'hydration-started':
      return {
        ...state,
        init: null,
        epIndex: 0,
        curName: '',
        playName: '',
        resolution: { kind: 'hydrating' },
        sourceFallback: { kind: 'idle' },
      };
    case 'hydration-completed':
      return {
        ...state,
        init: action.init,
        epIndex: action.epIndex,
        resolution: action.init.episodes.length === 0 ? { kind: 'idle' } : state.resolution,
      };
    case 'hydration-failed':
      return { ...state, resolution: { kind: 'failed', message: action.message } };
    case 'init-updated':
      return { ...state, init: action.init };
    case 'resolution-started':
      return {
        ...state,
        epIndex: action.epIndex,
        curName: action.curName,
        playName: action.playName,
        resolution: { kind: 'resolving' },
      };
    case 'resolution-succeeded':
      return { ...state, resolution: { kind: 'ready', url: action.url, parseName: action.parseName } };
    case 'drive-bind-required':
      return { ...state, resolution: { kind: 'drive-bind-required', provider: action.provider } };
    case 'resolution-failed':
      return { ...state, resolution: { kind: 'failed', message: action.message } };
    case 'source-fallback-searching':
      return { ...state, sourceFallback: { kind: 'searching' } };
    case 'source-fallback-switching':
      return { ...state, sourceFallback: { kind: 'switching', sourceName: action.sourceName } };
    case 'source-fallback-choices':
      return {
        ...state,
        sourceFallback: {
          kind: 'choices',
          candidates: action.candidates,
          incompleteSources: action.incompleteSources,
          truncated: action.truncated,
        },
      };
    case 'source-fallback-unavailable':
      return { ...state, sourceFallback: { kind: 'unavailable', message: action.message } };
    case 'source-fallback-cleared':
      return { ...state, sourceFallback: { kind: 'idle' } };
    case 'drive-bind-dismissed':
      return state.resolution.kind === 'drive-bind-required'
        ? { ...state, resolution: { kind: 'idle' } }
        : state;
  }
}

export function presentPlayerPageSession(state: PlayerPageSessionState): PlayerPageSessionPresentation {
  const resolution = state.resolution;
  return {
    init: state.init,
    epIndex: state.epIndex,
    activeUrl: resolution.kind === 'ready' ? resolution.url : '',
    curName: state.curName,
    playName: state.playName,
    resolving: resolution.kind === 'hydrating' || resolution.kind === 'resolving',
    driveBind: resolution.kind === 'drive-bind-required' ? resolution.provider : null,
    parseMsg: resolution.kind === 'failed' ? resolution.message : '',
    parseName: resolution.kind === 'ready' ? resolution.parseName : undefined,
    sourceFallback: state.sourceFallback,
  };
}
