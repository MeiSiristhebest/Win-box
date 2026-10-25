import { client } from '../../../api/client';
import type { BossKeyPlaybackEventsPort, RelaySpeedEventsPort } from '../application/playerRuntimeEventsPorts';

export const relaySpeedEventsAdapter: RelaySpeedEventsPort = {
  subscribe: (onSpeed) => client.netSpeed(onSpeed),
};

export const bossKeyPlaybackEventsAdapter: BossKeyPlaybackEventsPort = {
  subscribeEnter: (onEnter) => client.bossOnEnter(onEnter),
  subscribeExit: (onExit) => client.bossOnExit(onExit),
};
