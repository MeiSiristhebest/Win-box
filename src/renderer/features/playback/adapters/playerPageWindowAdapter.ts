import { client } from '../../../api/client';
import type { PlayerPageWindowPort } from '../application/playerPageSession';

export const playerPageWindowAdapter: PlayerPageWindowPort = {
  readAppIcon: () => client.appIcon(),
  readMaximized: () => client.winIsMaximized(),
  readAlwaysOnTop: () => client.winIsAlwaysOnTop(),
  setAlwaysOnTop: (enabled) => client.winSetAlwaysOnTop(enabled),
  minimize: async () => { await client.winMinimize(); },
  toggleMaximize: async () => {
    await client.winMaximize();
    return client.winIsMaximized();
  },
  setMini: async (enabled) => { await client.playerSetMini(enabled); },
  close: async () => { await client.winClose(); },
  onMiniChanged: (listener) => client.playerOnMini(listener),
};
