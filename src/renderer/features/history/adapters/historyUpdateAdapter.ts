import { client } from '../../../api/client';
import { latestEpisodeOf, type WatchHistory } from '../../../lib/uiMemory';
import { resolveHistorySource } from '../../../lib/historySource';
import type { HistoryUpdateLookupPort } from '../application/detectHistoryUpdates';

export const historyUpdateAdapter: HistoryUpdateLookupPort<WatchHistory> = {
  async latestEpisode({ subject }): Promise<number | null> {
    if (!subject.sourceKey || !subject.vodId) return null;
    const source = await resolveHistorySource(client, subject);
    const detail = await client.detail({ key: source.key, ids: [subject.vodId], profileId: source.profileId });
    return detail ? latestEpisodeOf(detail) : null;
  },
};
