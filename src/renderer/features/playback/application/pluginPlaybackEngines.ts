import type { PlayerEngineView } from '../../../../shared/plugin';

export interface PluginPlaybackEnginesSnapshot {
  engines: readonly PlayerEngineView[];
  enabledEngineIds: Readonly<Record<string, boolean>>;
}

/** Renderer capabilities used to discover and refresh third-party playback engines. */
export interface PluginPlaybackEnginesPort {
  loadSnapshot(): Promise<PluginPlaybackEnginesSnapshot>;
  subscribeToChanges(listener: () => void): () => void;
}
