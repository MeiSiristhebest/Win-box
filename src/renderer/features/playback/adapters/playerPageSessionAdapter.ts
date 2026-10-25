import { client } from '../../../api/client';
import { resolveHistorySource } from '../../../lib/historySource';
import type { PlayerInitData, PlayerPageSessionPort } from '../application/playerPageSession';

export const playerPageSessionAdapter: PlayerPageSessionPort = {
  play: (input) => client.play(input),
  resolveHistorySource: ({ profileId, sourceKey, sourceName }) => resolveHistorySource(client, {
    profileId,
    sourceKey,
    sourceName,
  }),
  loadDetail: (input) => client.detail(input),
  onInit: (listener) => client.playerOnInit((data) => {
    if (data) listener(data as PlayerInitData);
  }),
  onEpisodeSwitch: (listener) => client.playerOnSwitchEp(listener),
  ready: async () => { await client.playerReady(); },
  cleanupTemporaryFiles: () => client.quarkCleanup(),
};
