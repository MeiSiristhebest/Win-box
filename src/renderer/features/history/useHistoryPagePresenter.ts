import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProfileSitesView } from '../../../shared/types';
import type { WatchHistory } from '../../lib/uiMemoryTypes';
import { historyCategories } from '../../lib/historyCategories';
import {
  createHistoryUpdateCandidates,
  historyItemKey,
  openHistoryItemDetail,
  resumeHistoryItem,
  type HistoryPagePorts,
} from './application/historyPage';

export function useHistoryPagePresenter(ports: HistoryPagePorts) {
  const [items, setItems] = useState<WatchHistory[]>([]);
  const [profileView, setProfileView] = useState<ProfileSitesView>({ activeId: '', profiles: [] });
  const [category, setCategory] = useState('');
  const [lastDeleted, setLastDeleted] = useState<WatchHistory | null>(null);
  const [notice, setNotice] = useState('');
  const [updated, setUpdated] = useState<Record<string, boolean>>({});
  const [updateWave, setUpdateWave] = useState(0);
  const checkedUpdateKeys = useRef(new Set<string>());
  const updateBusy = useRef(false);

  const refresh = useCallback(() => setItems(ports.storage.list()), [ports]);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      void ports.catalog.load().then((view) => {
        if (active) setProfileView(view);
      }).catch(() => undefined);
    };
    load();
    const unsubscribe = ports.catalog.subscribe(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [ports]);

  useEffect(() => {
    ports.storage.hydrate();
    // oxlint-disable-next-line react/set-state-in-effect -- Hydration is synchronous external storage I/O; read the hydrated snapshot before subscribing to changes.
    refresh();
    return ports.storage.subscribe(refresh);
  }, [ports, refresh]);

  useEffect(() => {
    if (!items.length || updateBusy.current) return;
    const candidates = createHistoryUpdateCandidates(items);
    if (!candidates.some((candidate) => !checkedUpdateKeys.current.has(candidate.key))) return;
    updateBusy.current = true;
    void ports.updates.detect(candidates, checkedUpdateKeys.current)
      .then(({ checkedKeys, updatedKeys }) => {
        for (const key of checkedKeys) checkedUpdateKeys.current.add(key);
        if (updatedKeys.length) setUpdated((previous) => ({ ...previous, ...Object.fromEntries(updatedKeys.map((key) => [key, true])) }));
      })
      .catch(() => {
        for (const candidate of candidates) checkedUpdateKeys.current.add(candidate.key);
      })
      .finally(() => {
        updateBusy.current = false;
        setUpdateWave((wave) => wave + 1);
      });
  }, [items, ports, updateWave]);

  const groups = useMemo(() => historyCategories(items, profileView), [items, profileView]);
  const activeCategory = groups.some((group) => group.key === category) ? category : '';
  const visibleGroups = activeCategory ? groups.filter((group) => group.key === activeCategory) : groups;

  const play = useCallback(async (item: WatchHistory): Promise<void> => {
    setNotice('');
    try {
      const result = await resumeHistoryItem(item, ports.storage, ports.playback);
      if (result.kind === 'external') {
        const position = result.seconds > 0 ? `（从 ${formatPlaybackTime(result.seconds)} 继续）` : '';
        setNotice(`已用「${result.player || '外部播放器'}」播放${position}`);
        refresh();
      } else if (result.kind === 'failed') {
        setNotice(result.message);
      }
    } catch (cause) {
      setNotice(`历史播放失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [ports, refresh]);

  const openDetail = useCallback(async (item: WatchHistory): Promise<void> => {
    try {
      const opened = await openHistoryItemDetail(item, ports.storage, ports.playback);
      if (!opened) await play(item);
    } catch (cause) {
      setNotice(`打开详情失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [ports, play]);

  const remove = useCallback((item: WatchHistory): void => {
    if (ports.storage.remove(historyItemKey(item))) setLastDeleted(item);
    refresh();
  }, [ports, refresh]);

  const undoRemove = useCallback((): void => {
    if (!lastDeleted || !ports.storage.restore(lastDeleted)) return;
    setLastDeleted(null);
    refresh();
  }, [lastDeleted, ports, refresh]);

  const clearAll = useCallback(async (): Promise<void> => {
    if (!(await ports.confirmations.confirmClearAll(items.length))) return;
    ports.storage.clear();
    setLastDeleted(null);
    refresh();
  }, [items.length, ports, refresh]);

  const resumeCount = items.filter((item) => item.time > 0).length;

  return {
    items,
    groups,
    visibleGroups,
    activeCategory,
    lastDeleted,
    notice,
    updated,
    resumeCount,
    setCategory,
    play,
    openDetail,
    remove,
    undoRemove,
    dismissDeleted: () => setLastDeleted(null),
    dismissNotice: () => setNotice(''),
    clearAll,
    refresh,
  };
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return `${hours > 0 ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
