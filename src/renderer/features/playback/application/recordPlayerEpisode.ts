import type { PlayerHistoryProgressPort } from './playerHistoryProgress';
import type { PlayerInitData, PlayerSourceMemoryPort } from './playerPageSession';

export interface OpenedPlayerEpisode {
  data: PlayerInitData;
  index: number;
  displayName: string;
  episodeLabel: string;
}

/** Persist source memory and watch history after the selected episode has resolved successfully. */
export function recordOpenedPlayerEpisode(
  opened: OpenedPlayerEpisode,
  history: Pick<PlayerHistoryProgressPort, 'recordHistory' | 'persist'>,
  sourceMemory: PlayerSourceMemoryPort,
): void {
  const { data, index, displayName, episodeLabel } = opened;
  const episode = data.episodes[index];
  if (!episode) return;

  if (data.meta?.fromKey || data.meta?.id || data.key) {
    sourceMemory.rememberSource({
      fromKey: data.meta?.fromKey || data.key || '',
      id: data.meta?.id || '',
      name: displayName,
    });
  }

  history.recordHistory({
    url: episode.url,
    rawUrl: episode.url,
    flag: data.flag,
    name: displayName,
    pic: data.meta?.pic,
    remarks: episodeLabel,
    sourceName: data.meta?.sourceName,
    sourceKey: data.meta?.fromKey || data.key,
    profileId: data.meta?.profileId,
    vodId: data.meta?.vodId ?? data.meta?.id,
    time: data.startTime || 0,
  });
  history.persist();
}
