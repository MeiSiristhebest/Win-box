import type { PlayerInitHydrationPort, PlayerInitData } from './playerPageSession';

/** Restore source identity and episode choices for a history launch before requesting playback. */
export async function hydratePlayerInit(
  incoming: PlayerInitData,
  port: PlayerInitHydrationPort,
  isCurrent: () => boolean = () => true,
): Promise<PlayerInitData | null> {
  let data = incoming;
  if (data.key) {
    const source = await port.resolveHistorySource({
      profileId: data.meta?.profileId,
      sourceKey: data.key,
      sourceName: data.meta?.sourceName,
    });
    if (!isCurrent()) return null;
    data = { ...data, meta: { ...data.meta, profileId: source.profileId, sourceName: source.name } };
  }

  if (isCurrent() && data.episodes?.length === 1 && data.meta?.vodId && data.key) {
    try {
      const detail = await port.loadDetail({ key: data.key, ids: [data.meta.vodId], profileId: data.meta.profileId });
      if (!isCurrent()) return null;
      const episodes = detail?.episodes[data.flag] || [];
      const index = episodes.findIndex((episode) => episode.url === data.episodes[0].url);
      if (index >= 0) data = { ...data, episodes, epIndex: index };
    } catch {
      // Detail may be stale; keep the original episode URL playable.
    }
  }

  return isCurrent() ? data : null;
}
