import type { AggVodItem } from '../../shared/types';
import { sourceIdentityKey } from './aggSearch';
import PinyinMatch from 'pinyin-match';

export type SearchMatchMode = 'related' | 'all';
const episodeNumber = '[0-9零〇一二三四五六七八九十百两兩]+';
const episodeSuffix = new RegExp(`(?:第\\s*${episodeNumber}\\s*[集话話回]|(?:剧集|劇集)?更新(?:至|到)?\\s*${episodeNumber}|全\\s*${episodeNumber}\\s*[集话話]|[0-9]+\\s*[-~～至]\\s*[0-9]+\\s*[集话話]?).*$`, 'i');
const metadataTag = /[【[（(]([^】\]）)]*)[】\]）)]/g;
const isMetadata = /^(?:\d{4}|\d*[kp]|hd|hd中字|1080p|2160p|4k|国语|國語|粤语|粵語|日语|日語|英语|英語|中字|中英双字|简体|繁体|超清|高清|蓝光|藍光|完整版|全集|完结|完結|无删减|無刪減|独播|獨播|抢先|搶先|杜比|hdr|内嵌字幕|內嵌字幕)(?:[\s+/·-].*)?$/i;

const CHINESE_DIGIT_MAP: Record<string, string> = {
  '1': '一', '2': '二', '3': '三', '4': '四', '5': '五',
  '6': '六', '7': '七', '8': '八', '9': '九', '10': '十',
};

function matchPinyinScore(query: string, rawCandidate: string, cleanCandidate: string): number {
  const cleanMatch = PinyinMatch.match(cleanCandidate, query);
  if (cleanMatch) {
    const [start, end] = cleanMatch;
    if (start === 0 && end === cleanCandidate.length - 1) return 88;
    if (start === 0) return 75;
    return 60;
  }
  const seasonMatch = query.match(/^([a-z]+)\s*(\d+)$/i);
  if (seasonMatch) {
    const [, base, sNum] = seasonMatch;
    const baseMatch = PinyinMatch.match(cleanCandidate, base) || PinyinMatch.match(rawCandidate, base);
    if (baseMatch) {
      const cn = CHINESE_DIGIT_MAP[sNum] || sNum;
      const desiredPattern = new RegExp(`(?:第\\s*(?:${sNum}|${cn})\\s*[季部]|(?:^|[^\\d])${sNum}(?:$|[^\\d]))`, 'i');
      const hasDesired = desiredPattern.test(rawCandidate);
      const otherNums = Object.keys(CHINESE_DIGIT_MAP).filter(n => n !== sNum).map(n => `${n}|${CHINESE_DIGIT_MAP[n]}`).join('|');
      const conflictingPattern = new RegExp(`第\\s*(?:${otherNums})\\s*[季部]`, 'i');
      const hasConflicting = conflictingPattern.test(rawCandidate);
      if (!hasConflicting && hasDesired) {
        return 85;
      }
    }
  }
  const rawMatch = PinyinMatch.match(rawCandidate, query);
  if (rawMatch) {
    const [start] = rawMatch;
    return start === 0 ? 70 : 55;
  }
  return 0;
}

/** Remove episode/release captions without truncating real subtitles or sequels. */
export function movieSearchTitle(value: string): string {
  let title = (value || '').normalize('NFKC').replace(/<[^>]*>/g, '').trim();
  const quoted = /《([^》]+)》/.exec(title);
  if (quoted && title.slice(quoted.index + quoted[0].length).search(episodeSuffix) >= 0) title = quoted[1];
  title = title.replace(metadataTag, (whole, inside: string) => isMetadata.test(inside.trim()) ? ' ' : whole);
  title = title.replace(episodeSuffix, '').replace(/(?:全集|完整版|无删减|無刪減|在线观看|在線觀看|一口气看完|一口氣看完).*$/, '').trim();
  return title.replace(/^[\s《》「」『』:：-]+|[\s《》「」『』:：,，。._—-]+$/g, '').trim() || value.trim();
}

const compact = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Related titles only. Descriptions, actors and source-provided recommendations do not imply a title match. */
export function searchTitleScore(query: string, candidate: string): number {
  const title = movieSearchTitle(query);
  const q = compact(title), raw = compact(candidate), cleanTitle = movieSearchTitle(candidate), clean = compact(cleanTitle);
  if (!q || !raw) return 0;
  if (raw === q) return 100;
  if (/^[a-z]{1,3}$/i.test(title) && !new RegExp(`(?:^|[^a-z])${title}(?:$|[^a-z])`, 'i').test(candidate.normalize('NFKC'))) {
    if (!/\p{Script=Han}/u.test(candidate)) return 0;
  }
  const clip = /解说|解說|速看|预告|預告|片段|首播|第\s*[0-9零一二三四五六七八九十百]+\s*[集话話]/.test(candidate);
  if (!raw.includes(q) && !clean.includes(q)) {
    if (/\p{Script=Han}/u.test(candidate)) {
      const pinyinMatch = matchPinyinScore(q, candidate, cleanTitle);
      if (pinyinMatch > 0) {
        return Math.max(1, pinyinMatch - (clip ? 15 : 0));
      }
    }
    return 0;
  }
  return (clean === q ? 90 : raw.startsWith(q) ? 75 : 60) - (clip ? 15 : 0);
}

export interface SearchFilterOption { id: string; name: string; count: number; rawCount: number }
export interface SearchViewFilters { mode: SearchMatchMode; profileId?: string; sourceId?: string; defaultProfileId?: string }

/** One projection for both the search page and movie sources; never mutates cached reports. */
export function searchResultView(items: readonly AggVodItem[], query: string, filters: SearchViewFilters) {
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
