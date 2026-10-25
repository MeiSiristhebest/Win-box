import type { PlayerWindowReloadPort } from '../application/playerWindow';

/** Browser/Electron renderer adapter for reloading the player window after a recoverable failure. */
export const playerWindowReloadAdapter: PlayerWindowReloadPort = {
  reload: () => window.location.reload(),
};
