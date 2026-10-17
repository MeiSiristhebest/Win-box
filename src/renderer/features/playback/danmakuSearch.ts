import { client } from '../../api/client';
import { danmakuQueryCandidates } from '../../../engine/danmaku/normalizeQuery';
import { pickAnimesForExpand } from '../../../engine/danmaku/endpoints';
import type { DanmakuAnime, DanmakuCandidate } from '../../../shared/danmaku';

interface DanmakuMemoryEntry {
  source: string;
  sourceName?: string;
  anime?: string;
  bangumiId?: number;
  episodeId?: number;
  ep?: string;
  at?: number;
}

const MEMORY_KEY = 'winbox-dm-mem';
const MEMORY_LIMIT = 80;
const MAX_ANIME_EXPAND = 4;

function loadMemory(): Record<string, DanmakuMemoryEntry> {
  try {
    const value = localStorage.getItem(MEMORY_KEY);
    return value ? JSON.parse(value) as Record<string, DanmakuMemoryEntry> : {};
  } catch {
    return {};
  }
}

function saveMemory(memory: Record<string, DanmakuMemoryEntry>): void {
  try {
    const keys = Object.keys(memory);
    if (keys.length > MEMORY_LIMIT) {
      keys
        .sort((left, right) => (memory[left].at || 0) - (memory[right].at || 0))
        .slice(0, keys.length - MEMORY_LIMIT)
        .forEach((key) => delete memory[key]);
    }
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Search still works when renderer storage is unavailable.
  }
}

export function episodeMatches(title: string | undefined, episodeNumber: string | undefined, targetEpisode: string): boolean {
  if (!targetEpisode) return false;
  const number = (episodeNumber || '').trim();
  if (/^\d{1,4}$/.test(number) && number.replace(/^0+/, '') === targetEpisode) return true;
  if (!title) return false;
  const match = /[^\d]*(\d{1,4})/.exec(title);
  return !!match && match[1].replace(/^0+/, '') === targetEpisode;
}

export function orderCandidatesForEpisode(list: DanmakuCandidate[], targetEpisode: string): DanmakuCandidate[] {
  if (!targetEpisode) return list;
  const matches = list.filter((candidate) => episodeMatches(candidate.episodeTitle, candidate.episodeNumber, targetEpisode));
  const remaining = list.filter((candidate) => !episodeMatches(candidate.episodeTitle, candidate.episodeNumber, targetEpisode));
  return [...matches, ...remaining];
}

async function expandAnime(anime: DanmakuAnime): Promise<DanmakuCandidate[]> {
  if (!anime || !Number.isFinite(Number(anime.bangumiId)) || !anime.source) return [];
  try {
    return (await client.danmakuEpisodes(Number(anime.bangumiId), anime.title, anime.source)) || [];
  } catch {
    return [];
  }
}

function pickBestAnime(
  groups: Array<{ anime: DanmakuAnime; candidates: DanmakuCandidate[] }>,
  targetEpisode: string,
): { anime: DanmakuAnime; candidates: DanmakuCandidate[] } {
  const withEpisode = targetEpisode
    ? groups.filter((group) => group.candidates.some((candidate) => episodeMatches(candidate.episodeTitle, candidate.episodeNumber, targetEpisode)))
    : [];
  const pool = withEpisode.length ? withEpisode : groups;
  return pool.reduce((best, group) => (group.candidates.length > best.candidates.length ? group : best), pool[0]);
}

export async function searchDanmakuCandidates(
  baseName: string,
  season: number | undefined,
  targetEpisode: string,
  fresh: boolean,
): Promise<DanmakuCandidate[]> {
  if (!baseName) return [];

  if (!fresh) {
    const hit = loadMemory()[baseName];
    if (hit && hit.source && Number.isFinite(Number(hit.bangumiId))) {
      const candidates = await expandAnime({
        animeId: Number(hit.bangumiId),
        bangumiId: Number(hit.bangumiId),
        title: hit.anime || baseName,
        source: hit.source,
        sourceName: hit.sourceName || '记忆来源',
      });
      if (candidates.length) return candidates;
    }
  }

  for (const query of danmakuQueryCandidates(baseName)) {
    let animeResults: DanmakuAnime[] = [];
    try {
      animeResults = (await client.danmakuSearch(query, season)) || [];
    } catch {
      animeResults = [];
    }
    if (!animeResults.length) continue;

    const groups: Array<{ anime: DanmakuAnime; candidates: DanmakuCandidate[] }> = [];
    for (const anime of pickAnimesForExpand(animeResults, MAX_ANIME_EXPAND)) {
      const candidates = await expandAnime(anime);
      if (candidates.length) groups.push({ anime, candidates });
    }
    if (!groups.length) continue;

    const allCandidates = groups.flatMap((group) => group.candidates);
    const best = pickBestAnime(groups, targetEpisode);
    const memory = loadMemory();
    memory[baseName] = {
      source: best.anime.source,
      sourceName: best.anime.sourceName,
      anime: best.anime.title,
      bangumiId: best.anime.bangumiId,
      at: Date.now(),
    };
    saveMemory(memory);
    return allCandidates;
  }
  return [];
}
