import { FavoriteCollection } from './application/favoriteCollection';
import { createFavoritesBrowserPersistence, FAVORITES_EVENT, favoritesBrowserChangeNotifications } from './adapters/favoritesBrowserAdapter';

/** Renderer composition root: one collection instance is shared by detail, app, and favorites views. */
export const favorites = new FavoriteCollection(createFavoritesBrowserPersistence(), favoritesBrowserChangeNotifications);

export { FAVORITES_EVENT };
export { favoriteTitle } from './application/favoriteModel';
export {
  favoriteKey,
  favoriteKeyCandidates,
  mergeFavoriteViews,
  normalizeFavorite,
  type FavoriteInput,
  type FavoriteRef,
} from './application/favoriteCollection';
export type { FavoriteItem } from './application/favoriteModel';

export const loadFavorites = (): void => favorites.loadFavorites();
export const listFavorites = () => favorites.listFavorites();
export const listFavoritesWithKeys = () => favorites.listFavoritesWithKeys();
export const favoritesCount = (): number => favorites.favoritesCount();
export const findFavorite = (ref: Parameters<typeof favorites.findFavorite>[0]) => favorites.findFavorite(ref);
export const isFavorited = (ref: Parameters<typeof favorites.isFavorited>[0]): boolean => favorites.isFavorited(ref);
export const addFavorite = (input: Parameters<typeof favorites.addFavorite>[0]) => favorites.addFavorite(input);
export const removeFavorite = (key: string): boolean => favorites.removeFavorite(key);
export const restoreFavorite = (item: Parameters<typeof favorites.restoreFavorite>[0]): boolean => favorites.restoreFavorite(item);
export const updateFavorite = (key: string, patch: { title?: string; note?: string }): boolean => favorites.updateFavorite(key, patch);
export const clearFavorites = (): void => favorites.clearFavorites();
