import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePageActive } from '../../lib/keepAlive';
import { BOARD_PAGE_SIZE, type DiscoverBoardPage } from '../../../shared/discoverBoards';
import type { DiscoverBoardPort } from './application/discoveryPorts';

type Mode = 'initial' | 'more' | 'refresh';
interface FeedState { id: string; data?: DiscoverBoardPage; nextPage: number; loading: boolean; error: string; errorPhase?: Mode }

export function useDiscoverBoard(id: string, port: DiscoverBoardPort, capacity = 40) {
  const active = usePageActive();
  const [state, setState] = useState<FeedState>({ id, nextPage: 1, loading: true, error: '' });
  const latest = useRef(state);
  const idRef = useRef(id);
  const activeRef = useRef(active);
  const capacityRef = useRef(capacity);
  const generation = useRef(0);
  const sequence = useRef(0);
  const running = useRef<number | null>(null);
  const failedMode = useRef<Mode>('initial');
  useLayoutEffect(() => { idRef.current = id; activeRef.current = active; capacityRef.current = capacity; }, [id, active, capacity]);
  const cancel = useCallback(() => { generation.current++; running.current = null; }, []);
  const publish = useCallback((next: FeedState) => { latest.current = next; setState(next); }, []);
  const load = useCallback(async (mode: Mode): Promise<void> => {
    if (!activeRef.current || running.current !== null) return;
    const requestId = idRef.current;
    const epoch = generation.current;
    const token = ++sequence.current;
    running.current = token;
    const previous = latest.current.id === requestId ? latest.current : { id: requestId, nextPage: 1, loading: false, error: '' };
    if (mode === 'more' && previous.data && !previous.data.hasMore) { running.current = null; return; }
    const fresh = mode !== 'more';
    let sourcePage = fresh ? 1 : previous.nextPage;
    let accumulated = fresh ? undefined : previous.data;
    let pagesToRead = 1;
    const current = () => generation.current === epoch && idRef.current === requestId && activeRef.current;
    publish({ ...previous, loading: true, error: '', errorPhase: undefined });
    try {
      for (let read = 0; read < pagesToRead; read++) {
        if (!current()) return;
        const data = await port.loadPage(requestId, sourcePage, mode === 'refresh');
        if (!current()) return;
        const unit = data.pageSize || BOARD_PAGE_SIZE;
        if (read === 0) {
          const small = fresh && data.total !== null && data.total <= 60;
          pagesToRead = data.board.provider === 'plugin' ? 1 : small
            ? Math.max(1, Math.ceil(data.total! / unit))
            : Math.max(1, Math.min(6, Math.ceil(capacityRef.current / unit)));
        }
        const seen = new Set<string>();
        const items = [...(accumulated?.items || []), ...data.items].filter(item => {
          const key = String(item.doubanId || item.tmdbId || item.mediaType + ':' + item.title + ':' + item.year);
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
        const notices = [...new Set([accumulated?.notice, data.notice].filter(Boolean))];
        accumulated = { ...data, items, page: 1,
          fetchedAt: accumulated ? Math.min(accumulated.fetchedAt, data.fetchedAt) : data.fetchedAt,
          stale: !!accumulated?.stale || data.stale,
          ...(notices.length ? { notice: notices.join(' ') } : { notice: undefined }),
        };
        sourcePage++;
        if (sourcePage > 500) accumulated = { ...accumulated, hasMore: false };
        if (mode !== 'refresh') publish({ id: requestId, data: accumulated, nextPage: sourcePage, loading: true, error: '' });
        if (!data.hasMore || sourcePage > 500) break;
      }
      if (current()) publish({ ...latest.current, ...(mode === 'refresh' && accumulated ? { data: accumulated, nextPage: sourcePage } : {}), loading: false });
    } catch (error) {
      if (!current()) return;
      failedMode.current = mode;
      publish({ ...latest.current, loading: false, errorPhase: mode, error: error instanceof Error ? error.message : '暂时无法加载榜单' });
    } finally {
      if (running.current === token) running.current = null;
    }
  }, [port, publish]);
  useEffect(() => {
    cancel();
    if (latest.current.id !== id) publish({ id, nextPage: 1, loading: false, error: '' });
    else if (latest.current.loading) publish({ ...latest.current, loading: false });
    if (active && !latest.current.data) void load('initial');
    return cancel;
  }, [id, active, load, publish, cancel]);
  return {
    data: state.id === id ? state.data : undefined,
    loading: state.id !== id || state.loading,
    error: state.id === id ? state.error : '',
    errorPhase: state.id === id ? state.errorPhase : undefined,
    loadMore: useCallback(() => { void load('more'); }, [load]),
    refresh: useCallback(() => { void load('refresh'); }, [load]),
    retry: useCallback(() => { void load(failedMode.current); }, [load]),
  };
}
