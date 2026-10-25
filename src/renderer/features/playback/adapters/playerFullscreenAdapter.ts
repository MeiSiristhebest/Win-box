import { client } from '../../../api/client';
import type { PlayerFullscreenPort } from '../application/playerFullscreen';

/** Electron IPC adapter for native player-window fullscreen state. */
export const playerFullscreenAdapter: PlayerFullscreenPort = {
  readNativeFullscreen: async () => (await client.playerIsFullscreen()).fullscreen,
  setNativeFullscreen: async fullscreen => (await client.playerSetFullscreen(fullscreen)).fullscreen,
  setWindowResizable: async resizable => { await client.playerSetResizable(resizable); },
  subscribeToNativeFullscreen: listener => client.playerOnFullscreen(listener),
};
