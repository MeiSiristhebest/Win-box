import { client } from '../../../api/client';
import type { DanmakuSearchMemoryEntry } from '../application/danmakuSearchWorkflow';
import { createDanmakuSearchWorkflow } from '../application/danmakuSearchWorkflow';
import type { DanmakuControllerPorts } from '../application/danmakuControllerPorts';

const MEMORY_KEY = 'winbox-dm-mem';
const MEMORY_LIMIT = 80;

function loadSearchMemory(): Record<string, DanmakuSearchMemoryEntry> {
  try {
    const value = globalThis.localStorage.getItem(MEMORY_KEY);
    return value ? JSON.parse(value) as Record<string, DanmakuSearchMemoryEntry> : {};
  } catch {
    return {};
  }
}

function saveSearchMemory(memory: Record<string, DanmakuSearchMemoryEntry>): void {
  try {
    const keys = Object.keys(memory);
    if (keys.length > MEMORY_LIMIT) {
      keys
        .sort((left, right) => (memory[left].at || 0) - (memory[right].at || 0))
        .slice(0, keys.length - MEMORY_LIMIT)
        .forEach((key) => delete memory[key]);
    }
    globalThis.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Search remains available when renderer storage is unavailable.
  }
}

export const danmakuControllerAdapter: DanmakuControllerPorts = {
  loadSettings: () => client.danmakuGet(),
  saveSettings: (settings) => client.danmakuSet(settings),
  fetchEpisode: (episodeId, source) => client.danmakuFetch(episodeId, source),
  searchCandidates: createDanmakuSearchWorkflow({
    searchAnime: (query, season) => client.danmakuSearch(query, season),
    expandAnime: (anime) => client.danmakuEpisodes(Number(anime.bangumiId), anime.title, anime.source),
    loadMemory: loadSearchMemory,
    saveMemory: saveSearchMemory,
    now: () => Date.now(),
  }),
  onRealtimeDanmaku: (handler) => client.onDanmakuRealtime((ev) => handler(ev.text)),
};
