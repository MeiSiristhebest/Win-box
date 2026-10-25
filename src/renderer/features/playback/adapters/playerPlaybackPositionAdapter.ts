import { getPlayTime, setPlayTime } from '../../../lib/uiMemory';
import type { PlaybackPositionMemoryPort } from '../application/playbackSessionPorts';

export const playerPlaybackPositionAdapter: PlaybackPositionMemoryPort = {
  read: getPlayTime,
  save: setPlayTime,
};
