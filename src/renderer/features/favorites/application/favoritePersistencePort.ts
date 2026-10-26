import type { FavoriteItem } from './favoriteModel';

export type FavoritePersistenceSnapshot = {
  favorites?: Array<[string, unknown]>;
  deleted?: Array<[string, unknown]>;
} | null;

export type FavoritePersistenceWrite = {
  favorites: Array<[string, FavoriteItem]>;
  deleted: Array<[string, number]>;
};

/** Synchronous snapshot port; storage format and browser lifecycle stay in the adapter. */
export interface FavoritePersistencePort {
  read(): FavoritePersistenceSnapshot;
  write(snapshot: FavoritePersistenceWrite): void;
  clear(): void;
}

export interface FavoriteChangeNotificationPort {
  publishChanged(): void;
}
