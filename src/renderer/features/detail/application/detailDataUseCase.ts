import { EP_PAGE_SIZE } from '../../../lib/epPager';
import type { VodDetail } from '../../../../shared/types';
import { preferredPlaybackFlag } from '../../../../shared/playbackResult';
import type { DetailDataPort, DetailSelectionMemory } from './detailDataPorts';

export interface LoadDetailRouteRequest {
  key: string;
  id: string;
  requestedProfileId: string;
}

export interface LoadedDetailRoute {
  profileId: string;
  memoryKey: string;
  detail: VodDetail | null;
  flag: string;
  episodeIndex: number;
  episodePage: number;
}

/** Resolve profile-scoped detail and restore its last selected source/episode. */
export async function loadDetailRoute(
  request: LoadDetailRouteRequest,
  port: DetailDataPort,
): Promise<LoadedDetailRoute> {
  const profileId = request.requestedProfileId || await port.readActiveProfileId();
  const memoryKey = `${profileId}:${request.key}:${request.id}`;
  const detail = await port.loadDetail(request.key, request.id, profileId);
  let flag = '';
  let episodeIndex = 0;
  let episodePage = 0;

  if (detail?.flags.length) {
    const remembered: DetailSelectionMemory | undefined = port.readSelection(memoryKey);
    flag = remembered && detail.flags.includes(remembered.flag)
      ? remembered.flag
      : preferredPlaybackFlag(detail);
    const episodes = detail.episodes[flag] || [];
    episodeIndex = remembered && remembered.ep >= 0 && remembered.ep < episodes.length
      ? remembered.ep
      : 0;
    episodePage = Math.floor(episodeIndex / EP_PAGE_SIZE);
    port.rememberSelection(memoryKey, {
      flag,
      ep: episodeIndex,
      scrollTop: remembered?.scrollTop ?? 0,
    });
  }

  return { profileId, memoryKey, detail, flag, episodeIndex, episodePage };
}
