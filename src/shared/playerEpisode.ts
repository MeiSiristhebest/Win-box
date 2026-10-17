export interface PlayerEpisodeSwitch {
  key: string;
  vodId: string;
  flag: string;
  episodes: { name: string; url: string }[];
  epIndex: number;
  profileId?: string;
  sourceName?: string;
}

/** 同片才同步；线路及完整列表随选择一起替换，不沿用旧线路的下标。 */
export function applyEpisodeSwitch<T extends { key: string; meta?: { vodId?: string; id?: string; profileId?: string }; flag: string; episodes: { name: string; url: string }[]; epIndex: number; lastUrl: string; startTime?: number }>(current: T, request: PlayerEpisodeSwitch): T | null {
  if (current.key !== request.key || (current.meta?.vodId ?? current.meta?.id) !== request.vodId) return null;
  if (!Number.isInteger(request.epIndex) || request.epIndex < 0 || request.epIndex >= request.episodes.length) return null;
  return {
    ...current,
    flag: request.flag,
    episodes: request.episodes,
    epIndex: request.epIndex,
    lastUrl: '',
    startTime: 0,
    ...(current.meta && (request.profileId || request.sourceName)
      ? { meta: { ...current.meta, ...(request.profileId ? { profileId: request.profileId } : {}), ...(request.sourceName ? { sourceName: request.sourceName } : {}) } }
      : {}),
  };
}
