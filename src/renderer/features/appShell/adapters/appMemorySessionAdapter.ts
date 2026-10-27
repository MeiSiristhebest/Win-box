import { loadUiMemory, saveUiMemory } from '../../../lib/uiMemory';
import { FAVORITES_EVENT, loadFavorites } from '../../favorites/favoritesRuntime';
import type { AppMemorySessionPort } from '../application/appMemorySessionPort';

export const appMemorySessionAdapter: AppMemorySessionPort = {
  loadUiMemory,
  saveUiMemory,
  loadFavorites,
  publishHistoryRefresh: () => window.dispatchEvent(new Event('winbox:history-refresh')),
  publishFavoritesRefresh: () => window.dispatchEvent(new Event(FAVORITES_EVENT)),
  subscribeBeforeUnload(listener) {
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  },
  subscribePageHide(listener) {
    window.addEventListener('pagehide', listener);
    return () => window.removeEventListener('pagehide', listener);
  },
  subscribeVisibilityChange(listener) {
    const onVisibilityChange = () => listener(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  },
  subscribeWindowFocus(listener) {
    window.addEventListener('focus', listener);
    return () => window.removeEventListener('focus', listener);
  },
};
