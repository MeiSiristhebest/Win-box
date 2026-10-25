import { SearchResultsAccumulator } from '../../../../engine/vod/aggSearch';
import type { SearchAllProgressEvent, SearchAllReport } from '../../../../shared/types';
import type {
  MovieSourceFolderIdentity,
  MovieSourceFolderPort,
  MovieSourcesSearchPort,
} from './movieSourcesPorts';

export interface MovieSourcesProgress {
  done: number;
  total: number;
}

export interface MovieSourcesProgressUpdate {
  report: SearchAllReport;
  progress: MovieSourcesProgress;
}

export interface MovieSourcesSearchResult {
  report: SearchAllReport;
  progress: MovieSourcesProgress | null;
}

function abortError(): Error {
  const error = new Error('搜索已取消');
  error.name = 'AbortError';
  return error;
}

/** Resolve the all-profile scope and stream only events belonging to this query/scope. */
export async function searchMovieSources(
  query: string,
  refresh: boolean,
  port: MovieSourcesSearchPort,
  onProgress: (update: MovieSourcesProgressUpdate) => void,
  signal?: AbortSignal,
): Promise<MovieSourcesSearchResult> {
  if (signal?.aborted) throw abortError();
  const scope = await port.readScope();
  if (signal?.aborted) throw abortError();

  const profileIds = [...new Set(scope.profileIds)];
  if (!profileIds.length && !scope.hasConfiguredSources) {
    throw new Error('请先导入订阅，再搜索播放来源');
  }

  const acceptedProfiles = new Set(profileIds.length ? profileIds : [scope.activeProfileId]);
  const accumulator = new SearchResultsAccumulator();
  let latestProgress: MovieSourcesProgress | null = null;
  let unsubscribe: () => void = () => {};
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
  };
  const onAbort = () => dispose();

  unsubscribe = port.onProgress((event: SearchAllProgressEvent) => {
    if (disposed || event.wd !== query || !acceptedProfiles.has(event.profileId ?? '')) return;
    if (event.source) accumulator.add(event.source, { profileOrder: event.profileOrder, sourceOrder: event.sourceOrder });
    latestProgress = { done: event.done, total: event.total };
    onProgress({ report: accumulator.snapshot(), progress: latestProgress });
  });
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const options = profileIds.length
      ? { profileIds, refresh }
      : { profileId: scope.activeProfileId, refresh };
    const report = await port.searchAll(query, options);
    return { report, progress: latestProgress };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    dispose();
  }
}

/** Expand a cloud-drive folder while preserving the exact profile/source identity used to find it. */
export async function loadMovieSourceFolder(
  port: MovieSourceFolderPort,
  source: MovieSourceFolderIdentity,
) {
  const result = await port.category({
    key: source.sourceKey,
    tid: source.id,
    pg: '1',
    extend: {},
    profileId: source.sourceRef?.profileId,
  });

  return result.items.map(item => ({
    ...item,
    sourceKey: source.sourceKey,
    sourceRef: source.sourceRef,
    sourceName: source.sourceName,
    sourceProfileName: source.sourceProfileName,
    sameFromOtherSources: 0,
  }));
}
