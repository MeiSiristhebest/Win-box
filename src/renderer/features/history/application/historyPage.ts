import type { ProfileSitesView } from '../../../../shared/types';
import type { WatchHistory } from '../../../lib/uiMemoryTypes';
import { historyGroupKey, watchedEpisodeOf } from '../../../lib/uiHistoryMerge';
import type { HistorySourceMatch, HistorySourceRef } from '../../../lib/historySource';
import type { HistoryUpdateCandidate, HistoryUpdateDetection } from './detectHistoryUpdates';

export interface HistoryProfileCatalogPort {
  load(): Promise<ProfileSitesView>;
  subscribe(onChanged: () => void): () => void;
}

export interface HistoryStoragePort {
  hydrate(): void;
  list(): WatchHistory[];
  latest(key: string): WatchHistory | null;
  remove(key: string): boolean;
  restore(item: WatchHistory): boolean;
  clear(): void;
  subscribe(onChanged: () => void): () => void;
}

export interface HistoryExternalPlaybackRequest {
  key: string;
  profileId: string;
  flag: string;
  rawUrl: string;
  display: string;
  pic?: string;
  remarks?: string;
  sourceName: string;
  vodId?: string;
  seek: number;
}

export interface HistoryExternalPlaybackOutcome {
  played: boolean;
  player?: string;
  error?: string;
  fallbackReason?: string;
}

export interface HistoryPlayerOpenRequest {
  key: string;
  flag: string;
  episodes: Array<{ name: string; url: string }>;
  epIndex: number;
  title: string;
  subtitleTitle: string;
  lastUrl: string;
  lastName: string;
  startTime: number;
  meta: {
    pic?: string;
    remarks?: string;
    sourceName: string;
    vodId?: string;
    fromKey: string;
    profileId: string;
    id?: string;
  };
}

export interface HistoryPlaybackPort {
  resolveSource(ref: HistorySourceRef): Promise<HistorySourceMatch>;
  playExternally(request: HistoryExternalPlaybackRequest): Promise<HistoryExternalPlaybackOutcome>;
  confirmBuiltinFallback(reason: string): Promise<boolean>;
  openBuiltinPlayer(request: HistoryPlayerOpenRequest): Promise<void>;
  openDetail(source: HistorySourceMatch, vodId: string): Promise<void>;
}

export interface HistoryUpdatePort {
  detect(
    candidates: HistoryUpdateCandidate<WatchHistory>[],
    alreadyChecked: ReadonlySet<string>,
  ): Promise<HistoryUpdateDetection>;
}

export interface HistoryConfirmationPort {
  confirmClearAll(count: number): Promise<boolean>;
}

export interface HistoryPagePorts {
  catalog: HistoryProfileCatalogPort;
  storage: HistoryStoragePort;
  playback: HistoryPlaybackPort;
  updates: HistoryUpdatePort;
  confirmations: HistoryConfirmationPort;
}

export function historyItemKey(item: WatchHistory): string {
  return historyGroupKey(item) || item.url;
}

export function historyUpdateKey(item: WatchHistory): string {
  return JSON.stringify([historyItemKey(item), item.rawUrl || item.url]);
}

export function historyCoverItem(item: WatchHistory) {
  return {
    id: historyItemKey(item),
    name: (item.name || '').split(' - ')[0]?.trim() || '',
    pic: item.pic,
  };
}

export function createHistoryUpdateCandidates(items: readonly WatchHistory[]): HistoryUpdateCandidate<WatchHistory>[] {
  return items
    .filter((item) => item.sourceKey && item.vodId)
    .map((item) => ({ key: historyUpdateKey(item), watchedEpisode: watchedEpisodeOf(item), subject: item }));
}

export type HistoryPlaybackResult =
  | { kind: 'external'; player?: string; seconds: number }
  | { kind: 'builtin' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

/** Coordinates the history resume use case using only storage, source and playback ports. */
export async function resumeHistoryItem(
  item: WatchHistory,
  storage: HistoryStoragePort,
  playback: HistoryPlaybackPort,
): Promise<HistoryPlaybackResult> {
  const latest = storage.latest(historyItemKey(item)) || item;
  const source = await playback.resolveSource(latest);
  const rawUrl = latest.rawUrl || latest.url;
  const external = await playback.playExternally({
    key: source.key,
    profileId: source.profileId,
    flag: latest.flag || '',
    rawUrl,
    display: latest.name || '播放',
    pic: latest.pic,
    remarks: latest.remarks,
    sourceName: source.name,
    vodId: latest.vodId,
    seek: latest.time,
  });

  if (external.played) return { kind: 'external', player: external.player, seconds: latest.time };
  if (external.error) return { kind: 'failed', message: external.error };
  if (external.fallbackReason && !(await playback.confirmBuiltinFallback(external.fallbackReason))) {
    return { kind: 'cancelled' };
  }

  const baseTitle = (latest.name || '').split(' - ')[0] || latest.name || '';
  await playback.openBuiltinPlayer({
    key: source.key,
    flag: latest.flag || '',
    episodes: [{ name: latest.remarks || '播放', url: rawUrl }],
    epIndex: 0,
    title: baseTitle,
    subtitleTitle: baseTitle,
    lastUrl: '',
    lastName: latest.name || '播放',
    startTime: latest.time,
    meta: {
      pic: latest.pic,
      remarks: latest.remarks,
      sourceName: source.name,
      vodId: latest.vodId,
      fromKey: source.key,
      profileId: source.profileId,
      id: latest.vodId,
    },
  });
  return { kind: 'builtin' };
}

export async function openHistoryItemDetail(
  item: WatchHistory,
  storage: HistoryStoragePort,
  playback: HistoryPlaybackPort,
): Promise<boolean> {
  if (!item.sourceKey || !item.vodId) return false;
  const latest = storage.latest(historyItemKey(item)) || item;
  const source = await playback.resolveSource(latest);
  await playback.openDetail(source, latest.vodId || item.vodId);
  return true;
}
