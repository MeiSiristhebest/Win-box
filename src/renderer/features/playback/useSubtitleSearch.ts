import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { client } from '../../api/client';
import type { SubtitleCandidate } from '../../../shared/subtitle';
import { buildSearchQuery } from '../../../engine/subtitle/normalizeQuery';
import { parseSubtitleFile } from '../../../engine/subtitle/parseSubtitle';
import { subtitleEmptyReason } from '../../lib/subtitleText';

const SUB_MEM_KEY = 'winbox-sub-mem';
type SubtitleCue = { start: number; end: number; text: string };
interface SubtitleSearchState {
  url: string;
  candidates: SubtitleCandidate[];
  searching: boolean;
  message: string;
  activeSubtitle: string;
}

function emptySearchState(url: string): SubtitleSearchState {
  return { url, candidates: [], searching: false, message: '', activeSubtitle: '' };
}

function loadSubtitleMemory(): Record<string, string> {
  try {
    const json = localStorage.getItem(SUB_MEM_KEY);
    return json ? JSON.parse(json) as Record<string, string> : {};
  } catch {
    return {};
  }
}

function saveSubtitleMemory(memory: Record<string, string>): void {
  try { localStorage.setItem(SUB_MEM_KEY, JSON.stringify(memory)); } catch { /* local storage is optional */ }
}

interface UseSubtitleSearchOptions {
  url: string;
  resourceName?: string;
  onApply: (cues: SubtitleCue[]) => void;
}

export function useSubtitleSearch({ url, resourceName, onApply }: UseSubtitleSearchOptions) {
  const resourceKey = resourceName || '';
  const suggestedQuery = useMemo(() => {
    const memory = loadSubtitleMemory();
    return (memory[resourceKey] || '').trim() || buildSearchQuery(resourceKey);
  }, [resourceKey]);
  const [queryState, setQueryState] = useState(() => ({ resourceKey, value: suggestedQuery }));
  const query = queryState.resourceKey === resourceKey ? queryState.value : suggestedQuery;
  const setQuery = (value: string) => setQueryState({ resourceKey, value });
  const [searchState, setSearchState] = useState<SubtitleSearchState>(() => emptySearchState(url));
  const currentState = searchState.url === url ? searchState : emptySearchState(url);
  const updateSearchState = (patch: Partial<Omit<SubtitleSearchState, 'url'>>) => {
    setSearchState((previous) => ({
      ...(previous.url === url ? previous : emptySearchState(url)),
      ...patch,
      url,
    }));
  };
  const [tokenHint, setTokenHint] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    void client.subtitleProviders()
      .then((providers) => setTokenHint(!providers.some((provider) => provider.available)))
      .catch(() => setTokenHint(false));
  }, []);

  useLayoutEffect(() => {
    generationRef.current += 1;
  }, [url]);

  async function search() {
    const name = query.trim();
    if (!name) { updateSearchState({ message: '请填写要搜索的剧名', searching: false }); return; }
    const generation = ++generationRef.current;
    updateSearchState({ searching: true, message: '', candidates: [] });
    try {
      const report = await client.subtitleSearch(name);
      if (generation !== generationRef.current) return;
      const nextCandidates = report?.candidates || [];
      updateSearchState({ candidates: nextCandidates });
      if (nextCandidates.length && resourceName) {
        const autoQuery = buildSearchQuery(resourceName);
        if (name !== autoQuery) {
          const memory = loadSubtitleMemory();
          memory[resourceName] = name;
          saveSubtitleMemory(memory);
        }
      }
      if (!nextCandidates.length) updateSearchState({ message: subtitleEmptyReason(report) });
    } catch (error) {
      if (generation === generationRef.current) updateSearchState({ message: (error as Error).message });
    } finally {
      if (generation === generationRef.current) updateSearchState({ searching: false });
    }
  }

  async function selectCandidate(candidate: SubtitleCandidate) {
    const generation = ++generationRef.current;
    updateSearchState({ message: '' });
    try {
      const result = await client.subtitleFetch(candidate);
      if (generation !== generationRef.current) return;
      if (!result || !result.text) {
        updateSearchState({ message: result?.reason || '字幕下载为空' });
        return;
      }
      const cues = parseSubtitleFile(result.fileName || candidate.subname || '', result.text);
      if (!cues.length) {
        updateSearchState({ message: '字幕解析失败（' + (result.format || '未知格式') + '，无有效时间轴）' });
        return;
      }
      const fileName = result.fileName || candidate.subname || candidate.file;
      updateSearchState({ activeSubtitle: fileName, message: result.entries && result.entries > 1
        ? '已挂载 ' + cues.length + ' 条（包内 ' + result.entries + ' 个文件，取「' + result.fileName + '」）'
        : '字幕已挂载（' + cues.length + ' 条）' });
      console.info('[subtitle] ' + (result.fileName || candidate.subname) + '：解析 ' + cues.length + ' 条 cue（包内 ' + (result.entries ?? 1) + ' 个文件）');
      onApply(cues);
      void client.subtitleSet({ enabled: true }).catch(() => undefined);
    } catch (error) {
      if (generation === generationRef.current) updateSearchState({ message: (error as Error).message });
    }
  }

  return {
    query,
    setQuery,
    candidates: currentState.candidates,
    searching: currentState.searching,
    message: currentState.message,
    activeSubtitle: currentState.activeSubtitle,
    tokenHint,
    search,
    selectCandidate,
  };
}
