import type { PlayerViewportPort } from '../application/playerWindow';

/** Browser/Electron renderer adapter for reading the current viewport. */
export const playerViewportAdapter: PlayerViewportPort = {
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
};
