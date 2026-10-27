import { useEffect } from 'react';
import type { AppMemorySessionPort } from './application/appMemorySessionPort';

export interface AppMemorySessionOptions {
  isPlayerWindow: boolean;
  port: AppMemorySessionPort;
}

/** Keeps shared history/favorites in sync across windows without making the shell own event details. */
export function useAppMemorySession({ isPlayerWindow, port }: AppMemorySessionOptions): void {
  useEffect(() => {
    port.loadUiMemory();
    port.loadFavorites();

    const refreshSharedMemory = (): void => {
      port.loadUiMemory();
      port.publishHistoryRefresh();
      port.loadFavorites();
      port.publishFavoritesRefresh();
    };
    const flush = (): void => port.saveUiMemory();
    const unsubscribe = [
      port.subscribeBeforeUnload(flush),
      port.subscribePageHide(flush),
      port.subscribeVisibilityChange(hidden => {
        if (hidden) flush();
        else if (!isPlayerWindow) refreshSharedMemory();
      }),
      ...(!isPlayerWindow ? [port.subscribeWindowFocus(refreshSharedMemory)] : []),
    ];

    return () => {
      for (const stop of unsubscribe) stop();
      port.saveUiMemory();
    };
  }, [isPlayerWindow, port]);
}
