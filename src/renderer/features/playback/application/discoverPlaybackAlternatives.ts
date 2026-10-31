import type { AggVodItem, SearchAllReport, VodDetail } from '../../../../shared/types';
import type { PlayerInitData } from './playerPageSession';
import { matchPlaybackEpisode, playbackTitleYear, samePlaybackTitle } from './playbackSourceMatching';

export interface PlaybackAlternativeCandidate {
  id: string;
  sourceName: string;
  profileName: string;
  data: PlayerInitData;
}

export interface PlaybackAlternativeSearchResult {
  candidates: PlaybackAlternativeCandidate[];
  incompleteSources: number;
  truncated: boolean;
}

export interface PlaybackAlternativeSearchPort {
  search(query: string, signal: AbortSignal): Promise<SearchAllReport>;
  loadDetail(input: { key: string; id: string; profileId: string }): Promise<VodDetail | null>;
}

export interface DiscoverPlaybackAlternativesInput {
  current: PlayerInitData;
  episodeIndex: number;
  position: number;
  excludedSourceIds: ReadonlySet<string>;
}

const MAX_DETAIL_LOOKUPS = 3;
const SEARCH_DEADLINE_MS = 30_000;
const DETAIL_DEADLINE_MS = 10_000;

/** Search all configured profiles, then verify title/year/episode against each source's detail. */
export async function discoverPlaybackAlternatives(
  input: DiscoverPlaybackAlternativesInput,
  port: PlaybackAlternativeSearchPort,
  signal: AbortSignal,
): Promise<PlaybackAlternativeSearchResult> {
  if (signal.aborted) throw abortError();
  const selectedEpisode = input.current.episodes[input.episodeIndex];
  const currentId = input.current.meta?.vodId || input.current.meta?.id || '';
  const currentKey = input.current.meta?.fromKey || input.current.key;
  const currentProfileId = input.current.meta?.profileId || '';

  let currentDetail: VodDetail | null = null;
  if (currentId && currentKey && currentProfileId) {
    try {
      currentDetail = await withDeadline(port.loadDetail({ key: currentKey, id: currentId, profileId: currentProfileId }), DETAIL_DEADLINE_MS, signal);
    } catch {
      // The already-open player may have been launched from history or its detail endpoint may be stale.
      if (signal.aborted) throw abortError();
    }
  }

  const title = currentDetail?.name?.trim() || input.current.title.trim();
  if (!title || !selectedEpisode?.name.trim()) return { candidates: [], incompleteSources: 0, truncated: false };

  const controller = new AbortController();
  const abortSearch = () => controller.abort();
  signal.addEventListener('abort', abortSearch, { once: true });
  let report: SearchAllReport;
  try {
    report = await withDeadline(port.search(title, controller.signal), SEARCH_DEADLINE_MS, signal);
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    signal.removeEventListener('abort', abortSearch);
  }
  if (signal.aborted) throw abortError();

  const expectedYear = parseYear(currentDetail?.year) ?? playbackTitleYear(title);
  const uniqueItems = new Map<string, AggVodItem>();
  for (const item of report.items) {
    const profileId = item.sourceRef?.profileId;
    const sourceKey = item.sourceRef?.key || item.sourceKey;
    if (!profileId || !sourceKey || !item.id || item.tag === 'folder') continue;
    if (!samePlaybackTitle(title, item.name)) continue;
    if (expectedYear != null && (parseYear(item.year) ?? playbackTitleYear(item.name)) != null
      && (parseYear(item.year) ?? playbackTitleYear(item.name)) !== expectedYear) continue;
    if (profileId === currentProfileId && sourceKey === currentKey) continue;

    const id = sourceIdentity(profileId, sourceKey, item.id);
    if (input.excludedSourceIds.has(id)) continue;
    if (!uniqueItems.has(id)) uniqueItems.set(id, item);
  }

  const entries = [...uniqueItems.entries()];
  const truncated = entries.length > MAX_DETAIL_LOOKUPS;
  const exactItems = entries.slice(0, MAX_DETAIL_LOOKUPS);
  let failedDetailLookups = 0;
  const candidates = (await Promise.all(exactItems.map(async ([id, item]) => {
    const profileId = item.sourceRef!.profileId;
    const sourceKey = item.sourceRef!.key || item.sourceKey;
    let detail: VodDetail | null;
    try {
      detail = await withDeadline(port.loadDetail({ key: sourceKey, id: item.id, profileId }), DETAIL_DEADLINE_MS, signal);
    } catch {
      if (!signal.aborted) failedDetailLookups += 1;
      return null;
    }
    if (signal.aborted) return null;
    if (!detail?.name) {
      failedDetailLookups += 1;
      return null;
    }
    if (!samePlaybackTitle(title, detail.name)) return null;

    const targetYear = expectedYear;
    const candidateYear = parseYear(detail.year) ?? parseYear(item.year) ?? playbackTitleYear(detail.name);
    if (targetYear != null && candidateYear !== targetYear) return null;

    const episodeMatch = matchPlaybackEpisode(selectedEpisode.name, detail.episodes || {});
    if (episodeMatch.kind !== 'unique') return null;
    const episodes = detail.episodes[episodeMatch.match.flag];
    const episodeIndex = episodeMatch.match.index;
    if (!episodes?.[episodeIndex]) return null;

    const sourceName = item.sourceName || item.sourceKey;
    const displayTitle = detail.name.trim();
    const data: PlayerInitData = {
      key: sourceKey,
      flag: episodeMatch.match.flag,
      episodes,
      epIndex: episodeIndex,
      title: displayTitle,
      subtitleTitle: input.current.subtitleTitle,
      lastUrl: '',
      lastName: displayTitle,
      startTime: Math.max(0, input.position),
      deferHistoryUntilPlayback: true,
      meta: {
        pic: detail.pic || item.pic,
        remarks: item.remarks || detail.remarks,
        sourceName,
        vodId: item.id,
        fromKey: sourceKey,
        id: item.id,
        profileId,
      },
    };
    return {
      id,
      sourceName,
      profileName: item.sourceProfileName || '',
      data,
    } satisfies PlaybackAlternativeCandidate;
  }))).filter((candidate): candidate is PlaybackAlternativeCandidate => candidate != null);

  return {
    candidates,
    // Any failed or still-pending source might contain another exact match. A
    // single verified candidate is not safe to auto-select in that case.
    incompleteSources: Math.max(0, (report.pendingSources || 0) + (report.failedSources || 0) + failedDetailLookups),
    truncated,
  };
}

export function sourceIdentity(profileId: string, sourceKey: string, vodId: string): string {
  return `${profileId}\u001f${sourceKey}\u001f${vodId}`;
}

function parseYear(value: string | number | undefined): number | null {
  const match = String(value ?? '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => finish(() => reject(new Error('备用源搜索超时'))), timeoutMs);
    const onAbort = () => finish(() => reject(abortError()));
    const finish = (complete: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      complete();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}

function abortError(): Error {
  const error = new Error('备用源搜索已取消');
  error.name = 'AbortError';
  return error;
}
