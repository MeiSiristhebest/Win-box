import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ProfileSitesView } from '../../../shared/types';
import {
  groupFavoriteRows,
  parseFavoriteSnapshot,
  selectFavoriteRows,
  type FavoritesPagePorts,
} from './application/favoritesPage';
import { favoriteTitle, type FavoriteRow, type FavoriteSortMode } from './application/favoriteModel';

export function useFavoritesPagePresenter(ports: FavoritesPagePorts) {
  const snapshot = useSyncExternalStore(ports.favorites.subscribe, ports.favorites.snapshot, ports.favorites.snapshot);
  const rows = useMemo(() => parseFavoriteSnapshot(snapshot), [snapshot]);
  const [profileView, setProfileView] = useState<ProfileSitesView>({ activeId: '', profiles: [] });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FavoriteSortMode>('recent');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<{ key: string; title: string; note: string } | null>(null);
  const [lastDeleted, setLastDeleted] = useState<FavoriteRow | null>(null);
  const [notice, setNotice] = useState('');

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

  const keyword = query.trim().toLowerCase();
  const filtered = useMemo(() => selectFavoriteRows(rows, query, sort), [rows, query, sort]);
  const groups = useMemo(() => groupFavoriteRows(filtered, profileView), [filtered, profileView]);
  const activeCategory = groups.some((group) => group.key === category) ? category : '';
  const visibleGroups = activeCategory ? groups.filter((group) => group.key === activeCategory) : groups;

  const openDetail = useCallback(async (item: FavoriteRow): Promise<void> => {
    setNotice('');
    try {
      await ports.detail.open(item);
    } catch (cause) {
      setNotice(`打开详情失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [ports]);

  const remove = useCallback((item: FavoriteRow): void => {
    if (ports.favorites.remove(item.key)) setLastDeleted(item);
  }, [ports]);

  const undoRemove = useCallback((): void => {
    if (!lastDeleted || !ports.favorites.restore(lastDeleted)) return;
    setLastDeleted(null);
  }, [lastDeleted, ports]);

  const clearAll = useCallback(async (): Promise<void> => {
    if (!(await ports.confirmations.confirmClearAll(rows.length))) return;
    ports.favorites.clear();
    setLastDeleted(null);
    setEditing(null);
  }, [ports, rows.length]);

  const startEdit = useCallback((item: FavoriteRow): void => {
    setEditing({ key: item.key, title: (item.title || '').trim(), note: (item.note || '').trim() });
  }, []);

  const saveEdit = useCallback((): void => {
    if (!editing) return;
    ports.favorites.update(editing.key, { title: editing.title.trim(), note: editing.note.trim() });
    setEditing(null);
  }, [editing, ports]);

  const setEditTitle = useCallback((title: string): void => {
    setEditing((current) => current ? { ...current, title } : current);
  }, []);

  const setEditNote = useCallback((note: string): void => {
    setEditing((current) => current ? { ...current, note } : current);
  }, []);

  return {
    rows,
    filtered,
    groups,
    visibleGroups,
    activeCategory,
    keyword,
    query,
    sort,
    editing,
    lastDeleted,
    notice,
    setQuery,
    setSort,
    setCategory,
    setEditing,
    openDetail,
    remove,
    undoRemove,
    clearAll,
    startEdit,
    saveEdit,
    setEditTitle,
    setEditNote,
    cancelEdit: () => setEditing(null),
    dismissDeleted: () => setLastDeleted(null),
    dismissNotice: () => setNotice(''),
    titleOf: favoriteTitle,
  };
}
