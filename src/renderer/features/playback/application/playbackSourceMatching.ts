import { movieSearchTitle } from '../../../../shared/searchTitleMatching';
import type { Episode } from '../../../../shared/types';

export interface EpisodeSourceMatch {
  flag: string;
  index: number;
  episode: Episode;
}

export type EpisodeSourceMatchResult =
  | { kind: 'unique'; match: EpisodeSourceMatch }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number };

interface TitleIdentity {
  key: string;
  season: number | null;
  year: number | null;
}

const seasonPattern = /(?:第\s*([零〇一二三四五六七八九十百两兩\d]+)\s*[季部]|\bS(?:EASON)?\s*0*(\d{1,2})\b)/i;
const yearPattern = /(?:^|\D)((?:19|20)\d{2})(?:年)?(?=\D|$)/;
const punctuation = /[^\p{L}\p{N}]+/gu;

/**
 * Conservative identity comparison for automatic source changes.
 * Unlike searchTitleScore, this function does not accept prefixes, pinyin,
 * descriptions, or merely related titles.
 */
export function samePlaybackTitle(left: string, right: string): boolean {
  const a = titleIdentity(left);
  const b = titleIdentity(right);
  return Boolean(a.key && a.key.length >= 2 && a.key === b.key && a.season === b.season && a.year === b.year);
}

export function playbackTitleYear(value: string): number | null {
  return titleIdentity(value).year;
}

/** Never uses the source list index as evidence that two episodes are equal. */
export function matchPlaybackEpisode(
  selectedName: string,
  candidateEpisodes: Record<string, Episode[]>,
): EpisodeSourceMatchResult {
  const selectedOrdinal = episodeOrdinal(selectedName);
  const selectedLabel = normalizeEpisodeLabel(selectedName);
  if (selectedOrdinal == null && !selectedLabel) return { kind: 'none' };

  const matches: EpisodeSourceMatch[] = [];
  for (const [flag, episodes] of Object.entries(candidateEpisodes)) {
    episodes.forEach((episode, index) => {
      const matchesOrdinal = selectedOrdinal != null
        ? episodeOrdinal(episode.name) === selectedOrdinal
        : normalizeEpisodeLabel(episode.name) === selectedLabel;
      if (matchesOrdinal) matches.push({ flag, index, episode });
    });
  }

  if (matches.length === 0) return { kind: 'none' };
  if (matches.length !== 1) return { kind: 'ambiguous', count: matches.length };
  return { kind: 'unique', match: matches[0] };
}

function titleIdentity(raw: string): TitleIdentity {
  const source = (raw || '').normalize('NFKC').trim();
  const seasonMatch = seasonPattern.exec(source);
  const season = seasonMatch
    ? seasonMatch[1] ? parseChineseNumber(seasonMatch[1]) : Number(seasonMatch[2])
    : null;
  const yearMatch = yearPattern.exec(source);
  const parsedYear = yearMatch ? Number(yearMatch[1]) : null;
  const year = parsedYear && /\p{L}|\p{N}/u.test(source.replace(yearMatch?.[0] || '', '')) ? parsedYear : null;

  let title = movieSearchTitle(source).normalize('NFKC');
  title = title.replace(/[\s._-]+(?:2160p|1440p|1080p|720p|480p|4k|uhd|hdr10?|web-dl|web-rip|blu-ray|bd|hd)(?:[\s._-].*)?$/i, ' ');
  if (seasonMatch) title = title.replace(seasonMatch[0], ' ');
  if (year) title = title.replace(new RegExp(`(?:19|20)${String(year).slice(2)}年?`, 'g'), ' ');
  return {
    key: title.toLocaleLowerCase().replace(punctuation, ''),
    season: Number.isFinite(season) ? season : null,
    year,
  };
}

function episodeOrdinal(value: string): number | null {
  const normalized = (value || '').normalize('NFKC').trim();
  const seasonEpisode = /\bS\s*\d{1,2}\s*E\s*0*(\d{1,4})\b/i.exec(normalized);
  if (seasonEpisode) return Number(seasonEpisode[1]);

  const chinese = /第\s*([零〇一二三四五六七八九十百两兩\d]+)\s*[集话話回]/i.exec(normalized);
  if (chinese) return parseChineseNumber(chinese[1]);

  const ep = /(?:^|[^\p{L}\p{N}])(?:EP?|EPISODE)\s*0*(\d{1,4})(?=$|[^\p{L}\p{N}])/iu.exec(normalized);
  if (ep) return Number(ep[1]);

  const numericLabel = /^0*(\d{1,4})$/.exec(normalized);
  return numericLabel ? Number(numericLabel[1]) : null;
}

function normalizeEpisodeLabel(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\.(?:mkv|mp4|ts|m2ts|avi|rmvb|flv|mov|wmv|webm)$/i, '')
    .replace(punctuation, '');
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9,
  };
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char in digits) {
      current = digits[char];
      continue;
    }
    if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }
    if (char === '百') {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    return null;
  }
  const result = total + current;
  return Number.isFinite(result) && result > 0 ? result : null;
}
