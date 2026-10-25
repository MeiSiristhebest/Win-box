/** Electron window capability required by the player fullscreen controller. */
export interface PlayerFullscreenPort {
  readNativeFullscreen(): Promise<boolean>;
  setNativeFullscreen(fullscreen: boolean): Promise<boolean>;
  setWindowResizable(resizable: boolean): Promise<void>;
  subscribeToNativeFullscreen(listener: (fullscreen: boolean) => void): () => void;
}
