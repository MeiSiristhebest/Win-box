import type { AggVodItem } from '../../../../shared/types';
import { sourceIdentityKey } from '../../../../shared/sourceIdentity';
import { searchTitleScore, type SearchMatchMode } from '../../../../shared/searchTitleMatching';

export interface SearchFilterOption { id: string; name: string; count: number; rawCount: number }
export interface SearchViewFilters { mode: SearchMatchMode; profileId?: string; sourceId?: string; defaultProfileId?: string }

/** Projects an aggregate report into filtered, source-balanced cards without mutating its cache. */
export function projectSearchResults(items: readonly AggVodItem[], query: string, filters: SearchViewFilters) {
  const profiles = new Map<string, SearchFilterOption>();
  const sources = new Map<string, SearchFilterOption>();
  const sourceSequences = new Map<string, number>();
  const sourceOrders = new Map<string, number>();
  const ranked: Array<{ item: AggVodItem; score: number; sequence: number; sourceOrder: number }> = [];
  let relatedCount = 0;
  for (const item of items) {
    const profileId = item.sourceRef?.profileId ?? filters.defaultProfileId ?? '';
    const sourceId = sourceIdentityKey(profileId, item.sourceKey);
    const sequence = sourceSequences.get(sourceId) ?? 0;
    sourceSequences.set(sourceId, sequence + 1);
    if (!sourceOrders.has(sourceId)) sourceOrders.set(sourceId, sourceOrders.size);
    const score = item.tag === 'folder' ? 25 : searchTitleScore(query, item.name);
    if (score) relatedCount++;
    const accepted = filters.mode === 'all' || score > 0;
    const profile = profiles.get(profileId) ?? { id: profileId, name: item.sourceProfileName || '当前子仓', count: 0, rawCount: 0 };
    profile.rawCount++; if (accepted) profile.count++;
    profiles.set(profileId, profile);
    if (!filters.profileId || profileId === filters.profileId) {
      const source = sources.get(sourceId) ?? { id: sourceId, name: [item.sourceProfileName, item.sourceName || item.sourceKey].filter(Boolean).join(' / '), count: 0, rawCount: 0 };
      source.rawCount++; if (accepted) source.count++;
      sources.set(sourceId, source);
      if (accepted && (!filters.sourceId || sourceId === filters.sourceId)) ranked.push({ item, score, sequence, sourceOrder: sourceOrders.get(sourceId)! });
    }
  }
  // Spread equally relevant results across sources, so one clip source cannot fill the first screen.
  ranked.sort((a, b) => b.score - a.score || a.sequence - b.sequence || a.sourceOrder - b.sourceOrder);
  return { items: ranked.map(entry => entry.item), profiles: [...profiles.values()], sources: [...sources.values()], relatedCount, hiddenCount: filters.mode === 'related' ? items.length - relatedCount : 0, rawCount: items.length };
}
