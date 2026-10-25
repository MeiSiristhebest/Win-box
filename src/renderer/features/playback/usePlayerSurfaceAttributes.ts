import { useEffect } from 'react';
import { applyPlayerSurfaceState } from './playerSurfaceAttributes';

/** Browser adapter for global markers used by the player-window shell styles. */
export function usePlayerSurfaceAttributes(
  mpvSurfaceActive: boolean,
  controlsVisible: boolean,
  allowMpv: boolean,
): void {
  useEffect(() => applyPlayerSurfaceState(document.documentElement, {
    mpvSurfaceActive,
    playerWindowControlsHidden: allowMpv && !controlsVisible,
  }), [mpvSurfaceActive, controlsVisible, allowMpv]);
}
