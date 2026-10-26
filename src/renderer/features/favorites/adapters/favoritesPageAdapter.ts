import type { NavigateFunction } from 'react-router-dom';
import { client } from '../../../api/client';
import { openDetailRoute } from '../../../lib/detailWin';
import { restoreHistorySource } from '../../../lib/historySource';
import {
  FAVORITES_EVENT,
  clearFavorites,
  listFavoritesWithKeys,
  loadFavorites,
  removeFavorite,
  restoreFavorite,
  updateFavorite,
} from '../favoritesRuntime';
import type { FavoritesPagePorts } from '../application/favoritesPage';

export function createFavoritesPageAdapter(navigate: NavigateFunction): Omit<FavoritesPagePorts, 'confirmations'> {
  return {
    favorites: {
      snapshot: () => JSON.stringify(listFavoritesWithKeys()),
      subscribe: (onChanged) => {
        const refresh = (): void => { loadFavorites(); onChanged(); };
        window.addEventListener(FAVORITES_EVENT, refresh);
        window.addEventListener('storage', refresh);
        window.addEventListener('focus', refresh);
        refresh();
        return () => {
          window.removeEventListener(FAVORITES_EVENT, refresh);
          window.removeEventListener('storage', refresh);
          window.removeEventListener('focus', refresh);
        };
      },
      remove: removeFavorite,
      restore: restoreFavorite,
      clear: clearFavorites,
      update: updateFavorite,
    },
    catalog: {
      load: async () => {
        const [config, view] = await Promise.all([client.cfgGet(), client.cfgProfileSites()]);
        if (!view.profiles.some((profile) => profile.id === config.activeProfileId)) {
          view.profiles.push({ id: config.activeProfileId, name: '当前配置', sites: config.sources });
        }
        return { ...view, activeId: config.activeProfileId };
      },
      subscribe: (onChanged) => {
        window.addEventListener('winbox:sources-changed', onChanged);
        return () => window.removeEventListener('winbox:sources-changed', onChanged);
      },
    },
    detail: {
      open: async (item) => {
        if (!item.sourceKey || !item.vodId) return;
        const source = await restoreHistorySource(client, item);
        window.dispatchEvent(new CustomEvent('winbox:sources-changed'));
        await openDetailRoute((to) => navigate(to), source.key, item.vodId);
      },
    },
  };
}
