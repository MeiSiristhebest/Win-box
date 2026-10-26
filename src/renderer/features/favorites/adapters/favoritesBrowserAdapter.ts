import { canWriteRendererStorage } from '../../../lib/storageEpoch';
import type { FavoriteChangeNotificationPort, FavoritePersistencePort } from '../application/favoritePersistencePort';

export const FAVORITES_EVENT = 'winbox:favorites-changed';
const FAVORITES_KEY = 'winbox-favorites';

export function createFavoritesBrowserPersistence(): FavoritePersistencePort {
  return {
    read: () => {
      try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    write: (snapshot) => {
      if (!canWriteRendererStorage()) return;
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(snapshot));
      } catch {
        // Storage quotas and disabled storage must not block the collection UI.
      }
    },
    clear: () => {
      try {
        localStorage.removeItem(FAVORITES_KEY);
      } catch {
        // Ignore unavailable browser storage.
      }
    },
  };
}

export const favoritesBrowserChangeNotifications: FavoriteChangeNotificationPort = {
  publishChanged: () => {
    try {
      const browser = globalThis as unknown as { dispatchEvent?: (event: unknown) => void; Event?: new (type: string) => unknown };
      if (typeof browser.dispatchEvent === 'function' && typeof browser.Event === 'function') {
        browser.dispatchEvent(new browser.Event(FAVORITES_EVENT));
      }
    } catch {
      // The adapter is also imported in non-browser tests.
    }
  },
};
