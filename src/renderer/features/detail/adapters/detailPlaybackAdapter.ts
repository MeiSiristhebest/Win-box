import { client } from '../../../api/client';
import { schedulePersist, uiMem } from '../../../lib/uiMemory';
import type { DetailPlaybackPort } from '../application/detailPlaybackPorts';

/** Renderer IPC/storage adapter for resolving and remembering a selected detail episode. */
export const detailPlaybackAdapter: DetailPlaybackPort = {
  play: request => client.play({ key: request.key, flag: request.flag, id: request.episodeUrl, profileId: request.profileId }),
  rememberSelection: (key, selection) => uiMem.detail.set(key, selection),
  persistSelection: schedulePersist,
};
