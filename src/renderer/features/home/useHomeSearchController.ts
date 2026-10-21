import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { useSearchParams } from 'react-router-dom';
import type { SearchAllReport, SourceBean, VodItem } from '../../../shared/types';
import type { HomeSearchMem } from '../../lib/uiMemory';
import { uiMem, saveUiMemory } from '../../lib/uiMemory';
import { client } from '../../api/client';
import { mergeSearchResults, SearchResultsAccumulator } from '../../../engine/vod/aggSearch';
import { isSearchWindow, openSearchWindow } from '../../lib/searchWin';
import type { makeStaleGuard } from '../../lib/staleGuard';
import type { SortClassView } from './useHomeBrowseController';

type SearchGeneration = ReturnType<typeof makeStaleGuard>;
type SearchParamsSetter = ReturnType<typeof useSearchParams>[1];
type BrowseSnapshot = {
  key: string;
  items: VodItem[];
  classes: SortClassView[];
  pageInfo: { page: number; pagecount: number; total: number };
  pg: number;
  tid: string;
  filters: Record<string, string>;
  fallback: boolean;
};
type SearchFolder = { key: string; tid: string; name: string; profileId: string; sourceName?: string } | null;
type FolderBackSnapshot = {
  agg: SearchAllReport | null;
  aggScope: 'current' | 'all' | 'all-profiles';
  aggSrc: string;
  profileId: string;
  searchAllProfiles: boolean;
};

type HomeSearchControllerOptions = {
  pathname: string;
  setSearchParams: SearchParamsSetter;
  wd: string;
  setWd: Dispatch<SetStateAction<string>>;
  searchAllSources: boolean;
  setSearchAllSources: Dispatch<SetStateAction<boolean>>;
  searchAllProfiles: boolean;
  setSearchAllProfiles: Dispatch<SetStateAction<boolean>>;
  profiles: Array<{ id: string; name: string }>;
  sites: SourceBean[];
  profileIdRef: MutableRefObject<string>;
  keyRef: MutableRefObject<string>;
  requestedProfileId: string;
  aggParam: string;
  requestedAllProfiles: boolean;
  profileReady: boolean;
  aggMode: boolean;
  agg: SearchAllReport | null;
  aggScope: 'current' | 'all' | 'all-profiles';
  aggSrc: string;
  setAggMode: Dispatch<SetStateAction<boolean>>;
  setAggScope: Dispatch<SetStateAction<'current' | 'all' | 'all-profiles'>>;
  setAgg: Dispatch<SetStateAction<SearchAllReport | null>>;
  setAggProgress: Dispatch<SetStateAction<{ done: number; total: number; pending: number } | null>>;
  setAggCap: Dispatch<SetStateAction<number>>;
  setAggSrc: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setErr: Dispatch<SetStateAction<string>>;
  setItems: Dispatch<SetStateAction<VodItem[]>>;
  setClasses: Dispatch<SetStateAction<SortClassView[]>>;
  setPageInfo: Dispatch<SetStateAction<{ page: number; pagecount: number; total: number }>>;
  setPg: Dispatch<SetStateAction<number>>;
  setTid: Dispatch<SetStateAction<string>>;
  setFiltersActive: Dispatch<SetStateAction<Record<string, string>>>;
  setFallback: Dispatch<SetStateAction<boolean>>;
  loadHome: (key: string) => void | Promise<void>;
  items: VodItem[];
  classes: SortClassView[];
  pageInfo: { page: number; pagecount: number; total: number };
  pg: number;
  tid: string;
  filtersActive: Record<string, string>;
  fallback: boolean;
  contentRef: MutableRefObject<HTMLDivElement | null>;
  listGen: MutableRefObject<SearchGeneration>;
  searchGen: MutableRefObject<SearchGeneration>;
  browseSnapRef: MutableRefObject<BrowseSnapshot | null>;
  setHomeSearch: (next: HomeSearchMem | null) => void;
};

export function useHomeSearchController({
  pathname,
  setSearchParams,
  wd,
  setWd,
  searchAllSources,
  setSearchAllSources,
  searchAllProfiles,
  setSearchAllProfiles,
  profiles,
  sites,
  profileIdRef,
  keyRef,
  requestedProfileId,
  aggParam,
  requestedAllProfiles,
  profileReady,
  aggMode,
  agg,
  aggScope,
  aggSrc,
  setAggMode,
  setAggScope,
  setAgg,
  setAggProgress,
  setAggCap,
  setAggSrc,
  setLoading,
  setErr,
  setItems,
  setClasses,
  setPageInfo,
  setPg,
  setTid,
  setFiltersActive,
  setFallback,
  loadHome,
  items,
  classes,
  pageInfo,
  pg,
  tid,
  filtersActive,
  fallback,
  contentRef,
  listGen,
  searchGen,
  browseSnapRef,
  setHomeSearch,
}: HomeSearchControllerOptions) {
  const [folder, setFolder] = useState<SearchFolder>(null);
  const folderBackRef = useRef<FolderBackSnapshot | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aggRetryCount = useRef(0);

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    searchGen.current.next();
  }, [searchGen]);

  function applySearchMem(mem: HomeSearchMem) {
    if (mem.profileId) profileIdRef.current = mem.profileId;
    setWd(mem.wd);
    setAgg(mem.agg as SearchAllReport | null);
    setAggMode(true);
    setAggScope(mem.aggScope);
    setSearchAllSources(mem.searchAllSources);
    setSearchAllProfiles(!!mem.searchAllProfiles);
    setFolder(mem.folder ? { ...mem.folder, profileId: mem.folder.profileId ?? mem.profileId ?? profileIdRef.current } : null);
    requestAnimationFrame(() => {
      if (contentRef.current && uiMem.home.scrollTop) contentRef.current.scrollTop = uiMem.home.scrollTop;
    });
  }

  function saveSearchMem(
    term: string,
    agg: SearchAllReport | null,
    scope: 'current' | 'all' | 'all-profiles',
    allScope = searchAllSources,
    profileId = profileIdRef.current,
    allProfiles = searchAllProfiles,
  ) {
    setHomeSearch({ wd: term, profileId, aggMode: true, aggScope: scope, searchAllSources: allScope, searchAllProfiles: allProfiles, agg, folder: null });
    syncSearchUrl(term, allProfiles);
    saveUiMemory();
  }

  function syncSearchUrl(term: string, allProfiles = searchAllProfiles): void {
    if (pathname !== '/search') return;
    setSearchParams(term ? {
      agg: term,
      profiles: allProfiles ? 'all' : 'current',
      ...(isSearchWindow() ? { sw: '1', profileId: profileIdRef.current } : {}),
    } : {}, { replace: true });
  }

  function setProfileSearchScope(allProfiles: boolean): void {
    if (allProfiles && profiles.length < 2) return;
    setSearchAllProfiles(allProfiles);
    if (allProfiles) setSearchAllSources(true);
    if (wd.trim()) void doSearch(true, wd, true, allProfiles);
  }

  async function doSearch(
    force = false,
    termOverride?: string,
    forceAllScope?: boolean,
    forceAllProfileScope?: boolean,
    retrying = false,
  ) {
    const term = (termOverride ?? wd).trim();
    if (!term) return;
    if (!retrying) {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      aggRetryCount.current = 0;
    }
    if (pathname !== '/search' && !isSearchWindow()) {
      try { await openSearchWindow(term, profileIdRef.current || requestedProfileId || undefined, forceAllProfileScope ?? searchAllProfiles); } catch (e) { setErr(String(e)); }
      return;
    }
    const allProfileScope = forceAllProfileScope ?? searchAllProfiles;
    const allScope = allProfileScope || (forceAllScope ?? searchAllSources);
    const k = keyRef.current;
    const searchProfileId = profileIdRef.current;
    const gen = searchGen.current.next();
    listGen.current.next();
    if (!aggMode && items.length > 0) {
      browseSnapRef.current = { key: k, items, classes, pageInfo, pg, tid, filters: filtersActive, fallback };
    }

    if (allScope) {
      setLoading(true);
      setErr('');
      setAggMode(true);
      setAggScope(allProfileScope ? 'all-profiles' : 'all');
      if (allProfileScope) setSearchAllSources(true);
      setAgg(null);
      setItems([]);
      const selectedProfileIds = allProfileScope ? profiles.map((profile) => profile.id) : [searchProfileId];
      if (allProfileScope && selectedProfileIds.length === 0) {
        setAggProgress(null);
        setAggSrc('');
        setErr('没有可搜索的订阅档案');
        setLoading(false);
        return;
      }
      const acc = new SearchResultsAccumulator();
      let resultsChanged = false;
      setAggProgress(null);
      setAggCap(60);
      setAggSrc('');
      let progressed: { done: number; total: number; pending: number } | null = null;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flush = (): void => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (!searchGen.current.isCurrent(gen)) return;
        if (resultsChanged) {
          resultsChanged = false;
          setAgg(acc.snapshot());
        }
        if (progressed) setAggProgress(progressed);
      };
      const searchedProfileIds = new Set(selectedProfileIds);
      let off: () => void = () => undefined;
      try {
        off = client.onSearchAllProgress((ev) => {
          if (ev.wd !== term || !searchedProfileIds.has(ev.profileId ?? '')) return;
          if (!searchGen.current.isCurrent(gen)) return;
          if (ev.source) {
            acc.add(ev.source, { profileOrder: ev.profileOrder ?? 0, sourceOrder: ev.sourceOrder });
            resultsChanged = true;
          }
          progressed = { done: ev.done, total: ev.total, pending: ev.pending ?? Math.max(0, ev.total - ev.done) };
          if (!flushTimer) flushTimer = setTimeout(flush, 200);
        });
      } catch { /* Progress is optional; the search request still returns the complete report. */ }
      try {
        const report = await client.searchAll(term, allProfileScope
          ? { refresh: force, profileIds: [...searchedProfileIds] }
          : { refresh: force, profileId: searchProfileId });
        if (!searchGen.current.isCurrent(gen)) return;
        flush();
        setAgg(report);
        saveSearchMem(term, report, allProfileScope ? 'all-profiles' : 'all', true, searchProfileId, allProfileScope);
        if (report.pendingSources && report.pendingSources > 0) {
          if (aggRetryCount.current < 12) {
            aggRetryCount.current += 1;
            if (retryTimer.current) clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => {
              retryTimer.current = null;
              if (
                searchGen.current.isCurrent(gen)
                && keyRef.current === k
                && profileIdRef.current === searchProfileId
              ) {
                void doSearch(true, term, allScope, allProfileScope, true);
              }
            }, 30_000);
          }
        } else {
          aggRetryCount.current = 0;
        }
      } catch (e) {
        if (searchGen.current.isCurrent(gen)) setErr(`聚合搜索失败：${(e as Error).message}`);
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        off();
        if (searchGen.current.isCurrent(gen)) {
          setAggProgress(null);
          setLoading(false);
        }
      }
      return;
    }

    if (!k) {
      setErr('当前未选中任何源，无法搜索');
      return;
    }
    const site = sites.find((s) => s.key === k);
    setLoading(true);
    setErr('');
    setAggMode(true);
    setAggScope('current');
    setAgg(null);
    setItems([]);
    const startedAt = Date.now();
    try {
      const resultItems = await client.search({ key: k, wd: term, profileId: searchProfileId });
      if (!searchGen.current.isCurrent(gen)) return;
      const report = mergeSearchResults([{
        key: k,
        name: site?.name || k,
        status: resultItems.length > 0 ? 'ok' : 'empty',
        items: resultItems,
        ms: Date.now() - startedAt,
      }]);
      setAgg(report);
      saveSearchMem(term, report, 'current', false, searchProfileId, false);
    } catch (e) {
      if (!searchGen.current.isCurrent(gen)) return;
      const report = mergeSearchResults([{
        key: k,
        name: site?.name || k,
        status: 'error',
        error: (e as Error).message,
        ms: Date.now() - startedAt,
      }]);
      setAgg(report);
      saveSearchMem(term, report, 'current', false, searchProfileId, false);
    } finally {
      if (searchGen.current.isCurrent(gen)) setLoading(false);
    }
  }

  useEffect(() => {
    if (!aggParam || !profileReady) return;

    const mem = uiMem.home.search;
    const profileId = requestedProfileId || profileIdRef.current;
    if (
      isSearchWindow()
      && mem
      && mem.aggMode
      && mem.agg
      && mem.wd === aggParam
      && mem.profileId === profileId
      && !!mem.searchAllProfiles === requestedAllProfiles
    ) {
      applySearchMem(mem);
      return;
    }

    const generation = searchGen.current;
    setWd(aggParam);
    setSearchAllSources(true);
    setSearchAllProfiles(requestedAllProfiles);
    const frame = requestAnimationFrame(() => {
      void doSearch(false, aggParam, true, requestedAllProfiles);
    });
    return () => {
      cancelAnimationFrame(frame);
      generation.next();
    };
    // The route values identify this effect; action functions are recreated by the controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggParam, profileReady, requestedProfileId, requestedAllProfiles]);

  async function openFolder(sourceKey: string, id: string, name: string, profileId = profileIdRef.current): Promise<void> {
    const key = sourceKey || keyRef.current;
    if (!key) return;
    const sourceName = agg?.perSource.find((source) => source.key === key && (source.profileId ?? profileIdRef.current) === profileId)?.name
      || (profileId === profileIdRef.current ? sites.find((source) => source.key === key)?.name : undefined)
      || key;
    const generation = searchGen.current.next();
    folderBackRef.current = { agg, aggScope, aggSrc, profileId, searchAllProfiles };
    setLoading(true);
    setErr('');
    try {
      const result = await client.category({ key, tid: id, pg: '1', profileId });
      if (!searchGen.current.isCurrent(generation)) return;
      const items = (result?.items || []).map((item) => ({ ...item, sourceKey: item.sourceKey || key }));
      const report = mergeSearchResults([{
        key,
        name: `${sourceName} · ${name}`,
        status: items.length > 0 ? 'ok' : 'empty',
        items,
      }]);
      const nextFolder = { key, tid: id, name, profileId, sourceName };
      setFolder(nextFolder);
      setAggMode(true);
      setAggScope('current');
      setAgg(report);
      setAggSrc('');
      setAggCap(60);
      setHomeSearch({
        wd,
        profileId,
        aggMode: true,
        aggScope: 'current',
        searchAllSources,
        searchAllProfiles,
        agg: report,
        folder: nextFolder,
      });
      saveUiMemory();
    } catch (error) {
      if (searchGen.current.isCurrent(generation)) setErr(`展开「${name}」失败：${(error as Error).message}`);
    } finally {
      if (searchGen.current.isCurrent(generation)) setLoading(false);
    }
  }

  function exitFolder(): void {
    const snapshot = folderBackRef.current;
    const canRestoreSnapshot = !!snapshot && snapshot.profileId === profileIdRef.current;
    folderBackRef.current = null;
    searchGen.current.next();
    setFolder(null);
    setHomeSearch(
      canRestoreSnapshot && snapshot
        ? {
          wd,
          profileId: snapshot.profileId,
          aggMode: true,
          aggScope: snapshot.aggScope,
          searchAllSources: snapshot.aggScope === 'all' || snapshot.aggScope === 'all-profiles',
          searchAllProfiles: snapshot.searchAllProfiles,
          agg: snapshot.agg as HomeSearchMem['agg'],
          folder: null,
        }
        : null,
    );
    if (canRestoreSnapshot && snapshot) {
      setAgg(snapshot.agg);
      setAggScope(snapshot.aggScope);
      setSearchAllSources(snapshot.aggScope === 'all' || snapshot.aggScope === 'all-profiles');
      setSearchAllProfiles(snapshot.searchAllProfiles);
      setAggSrc(snapshot.aggSrc);
      setAggCap(60);
      return;
    }
    setAgg(null);
    if (wd.trim()) void doSearch(false, wd, false);
  }

  function exitSearch(): void {
    setWd('');
    setAggMode(false);
    setAgg(null);
    setAggSrc('');
    searchGen.current.next();
    setFolder(null);
    folderBackRef.current = null;
    setHomeSearch(null);
    syncSearchUrl('');
    saveUiMemory();
    const key = keyRef.current;
    const snapshot = browseSnapRef.current;
    if (snapshot && key && snapshot.key === key) {
      browseSnapRef.current = null;
      setErr('');
      setItems(snapshot.items);
      setClasses(snapshot.classes);
      setPageInfo(snapshot.pageInfo);
      setPg(snapshot.pg);
      setTid(snapshot.tid);
      setFiltersActive(snapshot.filters);
      setFallback(snapshot.fallback);
      return;
    }
    if (key) void loadHome(key);
  }

  return { applySearchMem, saveSearchMem, setProfileSearchScope, doSearch, folder, openFolder, exitFolder, exitSearch };
}
