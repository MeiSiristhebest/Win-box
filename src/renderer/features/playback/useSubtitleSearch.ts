import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SubtitleCandidate } from '../../../shared/subtitle';
import { buildSearchQuery } from '../../../engine/subtitle/normalizeQuery';
import type { SubtitleCue } from '../../../engine/subtitle/parseSubtitle';
import { subtitleEmptyReason } from '../../lib/subtitleText';
import type { SubtitleSearchDependencies } from './application/subtitleSearchPorts';
import { prepareSubtitleCandidate, searchSubtitleCandidates } from './application/subtitleSearchUseCases';

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

interface UseSubtitleSearchOptions {
  url: string;
  resourceName?: string;
  onApply: (cues: SubtitleCue[]) => void;
  dependencies: SubtitleSearchDependencies;
}

export function useSubtitleSearch({ url, resourceName, onApply, dependencies }: UseSubtitleSearchOptions) {
  const resourceKey = resourceName || '';
  const suggestedQuery = useMemo(() => {
    const remembered = dependencies.queryMemory.load()[resourceKey]?.trim();
    return remembered || buildSearchQuery(resourceKey);
  }, [dependencies.queryMemory, resourceKey]);
  const [queryState, setQueryState] = useState(() => ({ resourceKey, value: suggestedQuery }));
  const query = queryState.resourceKey === resourceKey ? queryState.value : suggestedQuery;
  const setQuery = (value: string) => setQueryState({ resourceKey, value });
  const restoreSuggestedQuery = () => setQuery(suggestedQuery);
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
    let active = true;
    void dependencies.service.listProviders()
      .then((providers) => { if (active) setTokenHint(!providers.some((provider) => provider.available)); })
      .catch(() => { if (active) setTokenHint(false); });
    return () => { active = false; };
  }, [dependencies.service]);

  useLayoutEffect(() => {
    generationRef.current += 1;
    return () => { generationRef.current += 1; };
  }, [url]);

  async function search() {
    const name = query.trim();
    if (!name) { updateSearchState({ message: '请填写要搜索的剧名', searching: false }); return; }
    const generation = ++generationRef.current;
    updateSearchState({ searching: true, message: '', candidates: [] });
    try {
      const report = await searchSubtitleCandidates(name, resourceName, dependencies);
      if (generation !== generationRef.current) return;
      const nextCandidates = report?.candidates || [];
      updateSearchState({ candidates: nextCandidates });
      if (!nextCandidates.length) updateSearchState({ message: subtitleEmptyReason(report) });
    } catch (error) {
      if (generation === generationRef.current) updateSearchState({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (generation === generationRef.current) updateSearchState({ searching: false });
    }
  }

  async function selectCandidate(candidate: SubtitleCandidate) {
    const generation = ++generationRef.current;
    updateSearchState({ message: '' });
    try {
      const prepared = await prepareSubtitleCandidate(candidate, dependencies.service);
      if (generation !== generationRef.current) return;
      if (prepared.kind === 'download-failed') {
        updateSearchState({ message: prepared.reason || '字幕下载为空' });
        return;
      }
      if (prepared.kind === 'parse-failed') {
        updateSearchState({ message: '字幕解析失败（' + (prepared.format || '未知格式') + '，无有效时间轴）' });
        return;
      }
      updateSearchState({ activeSubtitle: prepared.fileName, message: prepared.entries && prepared.entries > 1
        ? '已挂载 ' + prepared.cues.length + ' 条（包内 ' + prepared.entries + ' 个文件，取「' + prepared.fileName + '」）'
        : '字幕已挂载（' + prepared.cues.length + ' 条）' });
      onApply(prepared.cues);
      void dependencies.service.enableSubtitles().catch(() => undefined);
    } catch (error) {
      if (generation === generationRef.current) updateSearchState({ message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    query,
    setQuery,
    restoreSuggestedQuery,
    candidates: currentState.candidates,
    searching: currentState.searching,
    message: currentState.message,
    activeSubtitle: currentState.activeSubtitle,
    tokenHint,
    search,
    selectCandidate,
  };
}
