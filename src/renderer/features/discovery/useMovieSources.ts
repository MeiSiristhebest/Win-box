import { useEffect, useRef, useState } from 'react';
import type { SearchAllReport } from '../../../shared/types';
import { SearchResultsAccumulator } from '../../../engine/vod/aggSearch';
import { client } from '../../api/client';

type SourceSearchState = {
  key: string;
  report: SearchAllReport | null;
  progress: { done: number; total: number } | null;
  loading: boolean;
  error: string;
};

/** Search all saved profiles without changing the user's selected recommendation source. */
export function useMovieSources(title: string) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([title, revision]);
  const [state, setState] = useState<SourceSearchState | null>(null);
  const retryCount = useRef({ title, count: 0 });
  useEffect(() => {
    if (!title) return;
    if (retryCount.current.title !== title) retryCount.current = { title, count: 0 };
    let alive = true;
    let off = () => {};
    let flush: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let progress: SourceSearchState['progress'] = null;
    const accumulator = new SearchResultsAccumulator();
    void (async () => {
      try {
        const config = await client.cfgGet();
        if (!alive) return;
        const ids = [...new Set(config.profiles.map(profile => profile.id))];
        if (!ids.length && !config.sources.length) throw new Error('请先导入订阅，再搜索播放来源');
        const accepted = new Set(ids.length ? ids : [config.activeProfileId]);
        off = client.onSearchAllProgress(event => {
          if (!alive || event.wd !== title || !accepted.has(event.profileId ?? '')) return;
          if (event.source) accumulator.add(event.source, { profileOrder: event.profileOrder, sourceOrder: event.sourceOrder });
          progress = { done: event.done, total: event.total };
          if (!flush) flush = setTimeout(() => {
            flush = undefined;
            if (alive) setState({ key, report: accumulator.snapshot(), progress, loading: true, error: '' });
          }, 200);
        });
        const result = await client.searchAll(title, ids.length ? { profileIds: ids, refresh: revision > 0 } : { profileId: config.activeProfileId, refresh: revision > 0 });
        if (!alive) return;
        if (flush) { clearTimeout(flush); flush = undefined; }
        setState({ key, report: result, progress, loading: false, error: '' });
        if (result.pendingSources && retryCount.current.count < 12) {
          retryCount.current.count++;
          retry = setTimeout(() => { if (alive) setRevision(value => value + 1); }, 30_000);
        }
      } catch (cause) {
        if (alive) setState({ key, report: null, progress, loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        off();
      }
    })();
    return () => { alive = false; off(); if (flush) clearTimeout(flush); if (retry) clearTimeout(retry); };
  }, [title, revision, key]);
  const current = state?.key === key ? state : null;
  return {
    report: current?.report ?? null,
    progress: current?.progress ?? null,
    loading: current?.loading ?? Boolean(title),
    error: current?.error ?? '',
    refresh: () => { retryCount.current = { title, count: 0 }; setRevision(value => value + 1); },
  };
}
