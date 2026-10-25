import { pickAnimesForExpand } from '../../../../engine/danmaku/endpoints';
import { danmakuQueryCandidates } from '../../../../engine/danmaku/normalizeQuery';
import type { DanmakuAnime, DanmakuCandidate } from '../../../../shared/danmaku';

export interface DanmakuSearchMemoryEntry {
  source: string;
  sourceName?: string;
  anime?: string;
  bangumiId?: number;
  episodeId?: number;
  ep?: string;
  at?: number;
}

export interface DanmakuSearchPorts {
  searchAnime(query: string, season?: number): Promise<DanmakuAnime[]>;
  expandAnime(anime: DanmakuAnime): Promise<DanmakuCandidate[]>;
  loadMemory(): Record<string, DanmakuSearchMemoryEntry>;
  saveMemory(memory: Record<string, DanmakuSearchMemoryEntry>): void | Promise<void>;
  now(): number;
}

export type DanmakuCandidateSearch = (
  baseName: string,
  season: number | undefined,
  targetEpisode: string,
  fresh: boolean,
) => Promise<DanmakuCandidate[]>;

export function episodeMatches(
  title: string | undefined,
  episodeNumber: string | undefined,
  targetEpisode: string,
): boolean {
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

function pickBestAnime(
  groups: Array<{ anime: DanmakuAnime; candidates: DanmakuCandidate[] }>,
  targetEpisode: string,
): { anime: DanmakuAnime; candidates: DanmakuCandidate[] } {
  const withEpisode = targetEpisode
    ? groups.filter((group) => group.candidates.some((candidate) =>
      episodeMatches(candidate.episodeTitle, candidate.episodeNumber, targetEpisode)))
    : [];
  const pool = withEpisode.length ? withEpisode : groups;
  return pool.reduce((best, group) => group.candidates.length > best.candidates.length ? group : best, pool[0]);
}

/** Coordinates candidate queries and episode expansion without owning network or storage I/O. */
export function createDanmakuSearchWorkflow(ports: DanmakuSearchPorts): DanmakuCandidateSearch {
  return async (baseName, season, targetEpisode, fresh) => {
    if (!baseName) return [];

    if (!fresh) {
      const hit = ports.loadMemory()[baseName];
      if (hit?.source && Number.isFinite(Number(hit.bangumiId))) {
        try {
          const cachedCandidates = await ports.expandAnime({
            animeId: Number(hit.bangumiId),
            bangumiId: Number(hit.bangumiId),
            title: hit.anime || baseName,
            source: hit.source,
            sourceName: hit.sourceName || '记忆来源',
          });
          if (cachedCandidates.length) return cachedCandidates;
        } catch {
          // A stale search-memory entry must not prevent a fresh candidate search.
        }
      }
    }

    for (const query of danmakuQueryCandidates(baseName)) {
      let animeResults: DanmakuAnime[] = [];
      try {
        animeResults = (await ports.searchAnime(query, season)) || [];
      } catch {
        animeResults = [];
      }
      if (!animeResults.length) continue;

      const groups: Array<{ anime: DanmakuAnime; candidates: DanmakuCandidate[] }> = [];
      for (const anime of pickAnimesForExpand(animeResults, 4)) {
        try {
          const candidates = (await ports.expandAnime(anime)) || [];
          if (candidates.length) groups.push({ anime, candidates });
        } catch {
          // One unavailable source must not discard candidates from the remaining sources.
        }
      }
      if (!groups.length) continue;

      const allCandidates = groups.flatMap((group) => group.candidates);
      const best = pickBestAnime(groups, targetEpisode);
      const memory = { ...ports.loadMemory() };
      memory[baseName] = {
        source: best.anime.source,
        sourceName: best.anime.sourceName,
        anime: best.anime.title,
        bangumiId: best.anime.bangumiId,
        at: ports.now(),
      };
      try {
        await ports.saveMemory(memory);
      } catch {
        // Candidate search remains useful when the optional search-memory adapter fails.
      }
      return allCandidates;
    }

    return [];
  };
}
