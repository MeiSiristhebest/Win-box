import { useCallback, useEffect, useRef, useState } from 'react';
import { movieSearchTitle } from '../../../shared/searchTitleMatching';
import type { MovieSourcesSearchPort } from './application/movieSourcesPorts';
import { searchMovieSources, type MovieSourcesProgress, type MovieSourcesProgressUpdate } from './application/movieSourcesUseCases';

type SourceSearchState = {
  key: string;
  report: Awaited<ReturnType<typeof searchMovieSources>>['report'] | null;
  progress: MovieSourcesProgress | null;
  loading: boolean;
  error: string;
};

/** React lifecycle adapter for cross-profile movie-source search. */
export function useMovieSources(title: string, enabled: boolean, port: MovieSourcesSearchPort) {
  const query = movieSearchTitle(title);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([title, revision]);
  const [state, setState] = useState<SourceSearchState | null>(null);
  const retryCount = useRef({ title, count: 0 });
  useEffect(() => {
    if (!query || !enabled) return;
    if (retryCount.current.title !== title) retryCount.current = { title, count: 0 };
    let alive = true;
    let flush: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let progress: MovieSourcesProgress | null = null;
    let latestUpdate: MovieSourcesProgressUpdate | null = null;
    const abortController = new AbortController();
    void (async () => {
      try {
        const result = await searchMovieSources(query, revision > 0, port, update => {
          if (!alive) return;
          latestUpdate = update;
          progress = update.progress;
          if (!flush) flush = setTimeout(() => {
            flush = undefined;
            if (alive && latestUpdate) setState({ key, report: latestUpdate.report, progress, loading: true, error: '' });
          }, 200);
        }, abortController.signal);
        if (!alive) return;
        if (flush) { clearTimeout(flush); flush = undefined; }
        setState({ key, report: result.report, progress: result.progress, loading: false, error: '' });
        if (result.report.pendingSources && retryCount.current.count < 12) {
          retryCount.current.count++;
          retry = setTimeout(() => { if (alive) setRevision(value => value + 1); }, 30_000);
        }
      } catch (cause) {
        if (alive) setState({ key, report: null, progress, loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { alive = false; abortController.abort(); if (flush) clearTimeout(flush); if (retry) clearTimeout(retry); };
  }, [title, query, revision, key, enabled, port]);
  const current = state?.key === key ? state : null;
  return {
    report: current?.report ?? null,
    progress: current?.progress ?? null,
    loading: current?.loading ?? Boolean(query && enabled),
    error: current?.error ?? '',
    query,
    generation: key,
    refresh: useCallback(() => { retryCount.current = { title, count: 0 }; setRevision(value => value + 1); }, [title]),
  };
}
