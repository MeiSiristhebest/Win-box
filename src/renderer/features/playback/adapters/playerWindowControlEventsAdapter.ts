import { client } from '../../../api/client';
import type {
  PlayerWindowControlEventsPort,
} from '../application/playerWindowControl';

/** Bridges plugin-to-player window events from Electron IPC into the playback feature. */
export const playerWindowControlEventsAdapter: PlayerWindowControlEventsPort = {
  subscribe: (onControl) => client.onPlayerCtl(onControl),
};
