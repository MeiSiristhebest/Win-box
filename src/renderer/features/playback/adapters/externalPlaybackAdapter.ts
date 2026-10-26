import { client } from '../../../api/client';
import { detectMediaKind } from '../../../lib/mediaKind';
import { recordWatch, saveUiMemory } from '../../../lib/uiMemory';
import type { ExternalPlaybackPorts } from '../externalPlayback';

/** Electron IPC and renderer storage adapter for the external playback use case. */
export const rendererExternalPlaybackPorts: ExternalPlaybackPorts = {
  getPreferences: () => client.playerPrefsGet(),
  getActiveProfileId: async () => (await client.cfgGet()).activeProfileId || '',
  resolvePlayback: (input) => client.play(input),
  openExternal: (url, seek) => client.vodOpenExternal(url, undefined, seek),
  classifyMedia: detectMediaKind,
  recordWatch,
  persistHistory: saveUiMemory,
};
