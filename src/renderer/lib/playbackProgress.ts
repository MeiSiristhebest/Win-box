import type { SourceRef } from '../../shared/types';

export type PlaybackSourceRef = Pick<SourceRef, 'key'> & { profileId?: string };

/** Profile-scoped keys keep equal episode URLs from sharing playback progress across sources. */
export function playbackProgressKey(url: string, source?: PlaybackSourceRef): string {
  const profileId = (source?.profileId || '').trim();
  if (!profileId) return url;
  const sourceKey = (source?.key || '').trim();
  return `playback-progress:${JSON.stringify([profileId, sourceKey, url])}`;
}
