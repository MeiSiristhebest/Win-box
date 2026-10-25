import { client } from '../../../api/client';
import type { PlayerKernelCommandPort } from '../application/playerKernelCommandPort';
import type { PlayerMpvCommandPort } from '../application/playerWindowControl';

export const playerKernelCommandsAdapter: PlayerKernelCommandPort = {
  sendMpvCommand: (command) => client.mpvCmd(command),
  sendEngineCommand: (command) => client.engineCmd(command),
};

/** Narrow MPV-only command capability for remote player-window controls. */
export const playerMpvCommandAdapter: PlayerMpvCommandPort = {
  sendMpvCommand: (command) => client.mpvCmd(command),
};
