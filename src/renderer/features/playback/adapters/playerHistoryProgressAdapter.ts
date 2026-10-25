import { getPlayTime, markHistoryOnlyWriter, recordWatch, saveUiMemory } from '../../../lib/uiMemory';
import type { PlayerPageHistoryPort } from '../application/playerPageSession';

export const playerHistoryProgressAdapter: PlayerPageHistoryPort = {
  getPlaybackPosition: (url, source) => getPlayTime(url, source),
  recordHistory: recordWatch,
  persist: saveUiMemory,
  beginPlayerHistorySession: markHistoryOnlyWriter,
};
