import { client } from '../../../api/client';
import type { PluginPlaybackEnginesPort } from '../application/pluginPlaybackEngines';

/** Renderer IPC and window-event adapter for plugin playback-engine discovery. */
export const pluginPlaybackEnginesAdapter: PluginPlaybackEnginesPort = {
  async loadSnapshot() {
    const [engines, preferences] = await Promise.all([client.engineList(), client.playerPrefsGet()]);
    return { engines, enabledEngineIds: preferences.engineEnabled ?? {} };
  },
  subscribeToChanges(listener) {
    window.addEventListener('focus', listener);
    window.addEventListener('winbox:engines-changed', listener);
    return () => {
      window.removeEventListener('focus', listener);
      window.removeEventListener('winbox:engines-changed', listener);
    };
  },
};
