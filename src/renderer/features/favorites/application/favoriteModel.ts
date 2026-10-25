/** Domain record for a saved title; persistence keys are supplied by the repository. */
export interface FavoriteItem {
  name: string;
  sourceKey?: string;
  vodId?: string;
  profileId?: string;
  sourceName?: string;
  pic?: string;
  remarks?: string;
  year?: string;
  type?: string;
  title?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export type FavoriteRow = FavoriteItem & { key: string };
export type FavoriteSortMode = 'recent' | 'name';

export function favoriteTitle(item: FavoriteItem): string {
  const custom = (item.title || '').trim();
  if (custom) return custom;
  return (item.name || '').split(' - ')[0]?.trim() || item.name || '';
}
