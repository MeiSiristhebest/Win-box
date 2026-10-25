import { useCallback, useReducer } from 'react';
import {
  initialPlayerPlaybackPresentation,
  updatePlayerPlaybackPresentation,
  type PlayerPlaybackPresentationUpdate,
} from './application/PlayerPlaybackPresentation';

/** React adapter for the playback presentation model. */
export function usePlayerPlaybackPresentation() {
  const [state, dispatch] = useReducer(updatePlayerPlaybackPresentation, initialPlayerPlaybackPresentation);
  const update = useCallback((change: PlayerPlaybackPresentationUpdate) => dispatch(change), []);
  return { state, update };
}
