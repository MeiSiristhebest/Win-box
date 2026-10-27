export interface AppMemorySessionPort {
  loadUiMemory(): void;
  saveUiMemory(): void;
  loadFavorites(): void;
  publishHistoryRefresh(): void;
  publishFavoritesRefresh(): void;
  subscribeBeforeUnload(listener: () => void): () => void;
  subscribePageHide(listener: () => void): () => void;
  subscribeVisibilityChange(listener: (hidden: boolean) => void): () => void;
  subscribeWindowFocus(listener: () => void): () => void;
}
