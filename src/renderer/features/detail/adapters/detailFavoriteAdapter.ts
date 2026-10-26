import {
  addFavorite,
  FAVORITES_EVENT,
  findFavorite,
  removeFavorite,
} from '../../favorites/favoritesRuntime';
import type { DetailFavoritePort } from '../application/detailFavorite';

/** Bridges detail favorite actions to the shared collection and its change event. */
export const detailFavoriteAdapter: DetailFavoritePort = {
  findFavorite: (ref) => {
    const match = findFavorite(ref);
    return match ? { key: match.key } : null;
  },
  addFavorite: (input) => { addFavorite(input); },
  removeFavorite: (key) => { removeFavorite(key); },
  subscribe: (listener) => {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener(FAVORITES_EVENT, listener);
    return () => window.removeEventListener(FAVORITES_EVENT, listener);
  },
};
