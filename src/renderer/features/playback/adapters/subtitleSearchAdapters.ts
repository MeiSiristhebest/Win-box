import { client } from '../../../api/client';
import type { SubtitleQueryMemoryPort, SubtitleSearchPort } from '../application/subtitleSearchPorts';

const QUERY_MEMORY_KEY = 'winbox-sub-mem';

function readQueryMemory(): Record<string, string> {
  try {
    const raw = globalThis.localStorage.getItem(QUERY_MEMORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

function writeQueryMemory(queries: Record<string, string>): void {
  try { globalThis.localStorage.setItem(QUERY_MEMORY_KEY, JSON.stringify(queries)); } catch { /* Storage is optional. */ }
}

export const subtitleSearchServiceAdapter: SubtitleSearchPort = {
  listProviders: () => client.subtitleProviders(),
  search: (query) => client.subtitleSearch(query),
  fetch: (candidate) => client.subtitleFetch(candidate),
  enableSubtitles: () => client.subtitleSet({ enabled: true }),
};

export const subtitleQueryMemoryAdapter: SubtitleQueryMemoryPort = {
  load: readQueryMemory,
  save: writeQueryMemory,
};
