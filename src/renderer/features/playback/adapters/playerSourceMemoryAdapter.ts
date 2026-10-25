import { uiMem } from '../../../lib/uiMemory';
import type { PlayerSourceMemoryPort } from '../application/playerPageSession';

export interface PlayerSourceMemory {
  fromKey: string;
  id: string;
  name: string;
}

export const playerSourceMemoryAdapter: PlayerSourceMemoryPort = {
  rememberSource: (source) => { uiMem.playSource = source; },
};
