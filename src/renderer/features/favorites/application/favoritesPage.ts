import type { ProfileSitesView } from '../../../../shared/types';
import { historyCategories, type HistoryCategory } from '../../../lib/historyCategories';
import { favoriteTitle, type FavoriteItem, type FavoriteRow, type FavoriteSortMode } from './favoriteModel';

export interface FavoriteStoragePort {
  snapshot(): string;
  subscribe(onChanged: () => void): () => void;
  remove(key: string): boolean;
  restore(item: FavoriteRow): boolean;
  clear(): void;
  update(key: string, patch: Pick<FavoriteItem, 'title' | 'note'>): void;
}

export interface FavoriteProfileCatalogPort {
  load(): Promise<ProfileSitesView>;
  subscribe(onChanged: () => void): () => void;
}

export interface FavoriteDetailPort {
  open(item: FavoriteItem): Promise<void>;
}

export interface FavoriteConfirmationPort {
  confirmClearAll(count: number): Promise<boolean>;
}

export interface FavoritesPagePorts {
  favorites: FavoriteStoragePort;
  catalog: FavoriteProfileCatalogPort;
  detail: FavoriteDetailPort;
  confirmations: FavoriteConfirmationPort;
}

export function selectFavoriteRows(rows: FavoriteRow[], query: string, sort: FavoriteSortMode): FavoriteRow[] {
  const keyword = query.trim().toLowerCase();
  const filtered = rows.filter((item) => !keyword || [favoriteTitle(item), item.name, item.note, item.remarks, item.sourceName]
    .some((value) => (value || '').toLowerCase().includes(keyword)));
  return sort === 'name'
    ? [...filtered].sort((left, right) => favoriteTitle(left).localeCompare(favoriteTitle(right), 'zh'))
    : filtered;
}

export function groupFavoriteRows(rows: FavoriteRow[], profiles: ProfileSitesView): HistoryCategory<FavoriteRow>[] {
  return historyCategories(rows, profiles);
}

export function favoriteCoverItem(item: FavoriteItem) {
  return {
    id: `${item.sourceKey || ''}\u0000${item.vodId || ''}`,
    name: favoriteTitle(item),
    pic: item.pic,
  };
}

export function parseFavoriteSnapshot(snapshot: string): FavoriteRow[] {
  const stored = JSON.parse(snapshot) as Array<{ key: string; item: FavoriteItem }>;
  return stored.map(({ key, item }) => ({ ...item, key }));
}
