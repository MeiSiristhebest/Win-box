import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AggVodItem, SearchAllReport } from '../../../shared/types';
import { sourceIdentityKey } from '../../../shared/sourceIdentity';
import type { SearchMatchMode } from '../../../shared/searchTitleMatching';
import { projectSearchResults } from '../search/application/searchResultProjection';
import { rankSourcesWithComparison, type SourceComparisonScore } from '../../../engine/vod/sourceComparison';

export interface MovieSourcesPanelPort {
  loadFolder(item: AggVodItem): Promise<AggVodItem[]>;
  openDetail(item: AggVodItem): Promise<void>;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Own search result filtering, directory navigation and its asynchronous request lifecycle. */
export function useMovieSourcesPanelPresenter(
  report: SearchAllReport | null,
  query: string,
  searchGeneration: string,
  port: MovieSourcesPanelPort,
) {
  const [cap, setCap] = useState(60);
  const [profileId, setProfileId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [mode, setMode] = useState<SearchMatchMode>('related');
  const [folder, setFolder] = useState<{ name: string; items: AggVodItem[] } | null>(null);
  const [folderError, setFolderError] = useState('');
  const [folderLoadingContext, setFolderLoadingContext] = useState<string | null>(null);
  const [showStates, setShowStates] = useState(false);
  const folderRequest = useRef(0);
  const folderContext = JSON.stringify([query, searchGeneration, profileId, sourceId, mode]);
  const folderContextRef = useRef(folderContext);
  const folderLoading = folderLoadingContext === folderContext;
  useLayoutEffect(() => {
    if (folderContextRef.current === folderContext) return;
    folderContextRef.current = folderContext;
    folderRequest.current++;
  }, [folderContext]);
  const invalidateFolderRequest = useCallback(() => {
    folderRequest.current++;
    setFolderLoadingContext(null);
  }, []);
  useEffect(() => () => { folderRequest.current++; }, []);
  const resetForSearch = useCallback(() => {
    invalidateFolderRequest();
    setFolder(null);
    setFolderError('');
    setCap(60);
  }, [invalidateFolderRequest]);
  const view = useMemo(
    () => projectSearchResults(report?.items ?? [], query, { mode, profileId, sourceId }),
    [report, query, mode, profileId, sourceId],
  );
  const comparisonByItem = useMemo(() => {
    const ranked = rankSourcesWithComparison(view.items, report?.perSource ?? []);
    const map = new Map<string, SourceComparisonScore>();
    for (const entry of ranked) {
      map.set(JSON.stringify([entry.item.sourceRef?.profileId, entry.item.sourceKey, entry.item.id]), entry.comparison);
    }
    return map;
  }, [view.items, report?.perSource]);
  const sourceItems = folder?.items ?? view.items;
  const visibleItems = sourceItems.slice(0, cap);

  const openItem = useCallback(async (item: AggVodItem): Promise<void> => {
    setFolderError('');
    if (item.tag !== 'folder') {
      try { await port.openDetail(item); }
      catch (error) { setFolderError(failureMessage(error)); }
      return;
    }
    const context = folderContext;
    const request = ++folderRequest.current;
    setFolderLoadingContext(context);
    try {
      const items = await port.loadFolder(item);
      if (request === folderRequest.current && context === folderContextRef.current) {
        setFolder({ name: item.name, items });
        setCap(60);
      }
    } catch (error) {
      if (request === folderRequest.current && context === folderContextRef.current) setFolderError(failureMessage(error));
    } finally {
      if (request === folderRequest.current && context === folderContextRef.current) setFolderLoadingContext(null);
    }
  }, [folderContext, port]);

  const selectProfile = useCallback((id: string) => {
    if (id === profileId) return;
    invalidateFolderRequest();
    setFolderError('');
    setProfileId(id);
    setSourceId('');
    setCap(60);
  }, [invalidateFolderRequest, profileId]);
  const selectSource = useCallback((id: string) => {
    if (id === sourceId) return;
    invalidateFolderRequest();
    setFolderError('');
    setSourceId(id);
    setCap(60);
  }, [invalidateFolderRequest, sourceId]);
  const selectMode = useCallback((value: SearchMatchMode) => {
    if (value === mode) return;
    invalidateFolderRequest();
    setFolderError('');
    setMode(value);
    setCap(60);
  }, [invalidateFolderRequest, mode]);
  const showMore = useCallback(() => setCap((value) => value + 60), []);
  const backToResults = useCallback(() => {
    invalidateFolderRequest();
    setFolder(null);
    setFolderError('');
    setCap(60);
  }, [invalidateFolderRequest]);
  const toggleSourceStates = useCallback((open: boolean) => setShowStates(open), []);
  const hitSourceCount = new Set(view.items.map((item) => sourceIdentityKey(item.sourceRef?.profileId, item.sourceKey))).size;

  return {
    query,
    view,
    profileId,
    sourceId,
    mode,
    comparisonByItem,
    folder,
    folderError,
    folderLoading,
    sourceItems,
    visibleItems,
    showStates,
    hitSourceCount,
    openItem,
    backToResults,
    selectProfile,
    selectSource,
    selectMode,
    showMore,
    toggleSourceStates,
    resetForSearch,
  };
}
