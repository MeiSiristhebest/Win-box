import { client } from '../../../api/client';
import { SOURCES_CHANGED_EVENT } from '../../../lib/configEvents';
import type {
  LivePlaybackClockPort,
  LivePlaybackDataPort,
  LivePlaybackRefreshPort,
  LiveSelectionMemoryPort,
} from '../application/livePlaybackPorts';
import { parseLiveSelectionMemory } from '../application/livePlaybackPorts';

export const livePlaybackDataAdapter: LivePlaybackDataPort = {
  readConfiguration: () => client.cfgGet(),
  loadLineup: index => client.loadLive(index),
  setActiveLineup: index => client.cfgSetActiveLive(index),
  loadProgramGuide: (index, channels) => client.liveEpg(index, channels),
};

export const liveSelectionMemoryAdapter: LiveSelectionMemoryPort = {
  read: key => {
    try { return parseLiveSelectionMemory(globalThis.localStorage?.getItem(key)); }
    catch { return {}; }
  },
  write: (key, value) => {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); }
    catch { /* Remembering a live selection is optional when storage is unavailable. */ }
  },
};

export const livePlaybackRefreshAdapter: LivePlaybackRefreshPort = {
  onSourcesChanged: listener => {
    window.addEventListener(SOURCES_CHANGED_EVENT, listener);
    return () => window.removeEventListener(SOURCES_CHANGED_EVENT, listener);
  },
  onWindowFocus: listener => {
    window.addEventListener('focus', listener);
    return () => window.removeEventListener('focus', listener);
  },
};

export const livePlaybackClockAdapter: LivePlaybackClockPort = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const livePlaybackDependencies = {
  data: livePlaybackDataAdapter,
  memory: liveSelectionMemoryAdapter,
  refresh: livePlaybackRefreshAdapter,
  clock: livePlaybackClockAdapter,
};
