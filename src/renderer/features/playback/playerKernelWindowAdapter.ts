import { client } from '../../api/client';
import type { PlayerKernelWindowPort } from './application/playerKernelTransitions';

/** Browser/Electron window operations used by kernel transitions. */
export const playerKernelWindowAdapter: PlayerKernelWindowPort = {
  documentFullscreen: () => !!document.fullscreenElement,
  exitFullscreen: (mode) => mode === 'native' ? client.playerSetFullscreen(false) : document.exitFullscreen(),
};
