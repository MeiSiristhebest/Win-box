import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { VodItem } from '../../../shared/types';
import { makeStaleGuard } from '../../lib/staleGuard';
import { appendUniqueItems, pageSignature } from '../../lib/listAppend';
import type { HomeBrowsePort, HomeBrowseSessionPort, HomeCategoryStateMemoryPort, HomeSortClassView } from './application/homePorts';
import { createHomeBrowseSearchSession, type HomeBrowseSnapshot } from './application/homeBrowseSearchSession';
import type { HomeWaterfallObserverPort } from './application/homeWaterfallObserverPort';
import { useHomeWaterfallObserver } from './useHomeWaterfallObserver';

type HomeBrowseControllerOptions = {
  data: HomeBrowsePort;
  key: string;
  setKey: Dispatch<SetStateAction<string>>;
  keyRef: MutableRefObject<string>;
  profileIdRef: MutableRefObject<string>;
  contentRef: MutableRefObject<HTMLDivElement | null>;
  browseLoading: boolean;
  aggMode: boolean;
  waterfall: boolean;
  waterfallObserver: HomeWaterfallObserverPort;
  categoryState: HomeCategoryStateMemoryPort;
  setBrowseLoading: Dispatch<SetStateAction<boolean>>;
  setBrowseError: Dispatch<SetStateAction<string>>;
  onBrowseStart: () => void;
  onMemoryRestoreStart?: () => void;
};

export function useHomeBrowseController({
  data,
  key,
  setKey,
  keyRef,
  profileIdRef,
  contentRef,
  browseLoading,
  aggMode,
  waterfall,
  waterfallObserver,
  categoryState,
  setBrowseLoading,
  setBrowseError,
  onBrowseStart,
  onMemoryRestoreStart,
}: HomeBrowseControllerOptions) {
  const [classes, setClasses] = useState<HomeSortClassView[]>([]);
  const [tid, setTid] = useState('');
  const [filtersActive, setFiltersActive] = useState<Record<string, string>>({});
  const [jumpPageInput, setJumpPageInput] = useState('');
  const [items, setItems] = useState<VodItem[]>([]);
  const [pg, setPg] = useState(1);
  const [pageInfo, setPageInfo] = useState({ page: 0, pagecount: 0, total: 0 });
  const [wfNoMore, setWfNoMore] = useState(false);
  const [fallback, setFallback] = useState(false);
  const wfBusyRef = useRef(false);
  const wfSigRef = useRef('');
  const listGen = useRef(makeStaleGuard());
  const homeMetadataGen = useRef(makeStaleGuard());
  const prepRetryCount = useRef(0);
  const prepRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBrowseStartRef = useRef(onBrowseStart);
  onBrowseStartRef.current = onBrowseStart;
  const onMemoryRestoreStartRef = useRef(onMemoryRestoreStart);
  onMemoryRestoreStartRef.current = onMemoryRestoreStart;
  const browseSnapshotStateRef = useRef<HomeBrowseSnapshot | null>(null);
  browseSnapshotStateRef.current = {
    key: keyRef.current,
    items,
    classes,
    pageInfo,
    pg,
    tid,
    filters: filtersActive,
    fallback,
  };
  const [browseSearchSession] = useState(() => createHomeBrowseSearchSession({
    activeProfileId: () => profileIdRef.current,
    setActiveProfileId: (profileId) => { profileIdRef.current = profileId; },
    activeSourceKey: () => keyRef.current,
    invalidateBrowseRequests: () => {
      listGen.current.next();
      homeMetadataGen.current.next();
    },
    currentSnapshot: () => browseSnapshotStateRef.current,
  }));

  function notifyBrowseStarted(): void {
    browseSearchSession.browseStarted();
    onBrowseStartRef.current();
  }

  function clearBrowse(message = '') {
    if (prepRetryTimer.current) clearTimeout(prepRetryTimer.current);
    prepRetryTimer.current = null;
    prepRetryCount.current = 0;
    listGen.current.next();
    homeMetadataGen.current.next();
    notifyBrowseStarted();
    keyRef.current = '';
    setKey('');
    setClasses([]);
    setTid('');
    setFiltersActive({});
    setItems([]);
    setPageInfo({ page: 0, pagecount: 0, total: 0 });
    setPg(1);
    setFallback(false);
    setBrowseLoading(false);
    setBrowseError(message);
  }

  function restoreSnapshot(snapshot: HomeBrowseSnapshot): void {
    listGen.current.next();
    homeMetadataGen.current.next();
    keyRef.current = snapshot.key;
    setKey(snapshot.key);
    setItems(snapshot.items);
    setClasses(snapshot.classes);
    setPageInfo(snapshot.pageInfo);
    setPg(snapshot.pg);
    setTid(snapshot.tid);
    setFiltersActive(snapshot.filters);
    setFallback(snapshot.fallback);
  }

  async function loadHome(k: string, retry = false) {
    notifyBrowseStarted();
    if (prepRetryTimer.current) {
      clearTimeout(prepRetryTimer.current);
      prepRetryTimer.current = null;
    }
    if (!retry) prepRetryCount.current = 0;
    // A new browse request invalidates category pages and older home requests.
    const gen = listGen.current.next();
    homeMetadataGen.current.next();
    keyRef.current = k;
    setKey(k);
    setClasses([]);
    setTid('');
    setFiltersActive({});
    setItems([]);
    setPageInfo({ page: 0, pagecount: 0, total: 0 });
    setPg(1);
    setFallback(false);
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const r = await data.home(k, profileIdRef.current);
      if (!listGen.current.isCurrent(gen)) return;
      setClasses(r.sortClasses);
      setTid('');
      setFiltersActive({});
      setItems(r.items);
      setPageInfo({ page: r.page, pagecount: r.pagecount, total: r.total });
      setPg(1);
      setFallback(!!r.homeFallback);
      setBrowseError(r.contentNotice || '');
      prepRetryCount.current = 0;
    } catch (e) {
      if (!listGen.current.isCurrent(gen)) return;
      const msg = (e as Error).message;
      setBrowseError(msg);
      setItems([]);
      setClasses([]);
      setFallback(false);
      if (/首次使用该源|正在后台/.test(msg) && prepRetryCount.current < 12) {
        prepRetryCount.current += 1;
        if (prepRetryTimer.current) clearTimeout(prepRetryTimer.current);
        prepRetryTimer.current = setTimeout(() => {
          prepRetryTimer.current = null;
          if (keyRef.current === k && listGen.current.isCurrent(gen)) void loadHome(k, true);
        }, 20_000);
      }
    } finally {
      if (listGen.current.isCurrent(gen)) setBrowseLoading(false);
    }
  }

  useEffect(() => () => {
    if (prepRetryTimer.current) clearTimeout(prepRetryTimer.current);
    listGen.current.next();
    homeMetadataGen.current.next();
  }, []);

  async function loadCategory(t: string, page: number, extend: Record<string, string> = {}, append = false) {
    const k = keyRef.current;
    if (!k) return;
    if (prepRetryTimer.current) {
      clearTimeout(prepRetryTimer.current);
      prepRetryTimer.current = null;
    }
    const gen = listGen.current.next();
    setBrowseLoading(true);
    setBrowseError('');
    setFallback(false);
    try {
      const profileId = profileIdRef.current;
      const r = t
        ? await data.category({ key: k, tid: t, pg: String(page), extend: Object.fromEntries(Object.entries(extend).filter(([, value]) => value !== '')), profileId })
        : await data.home(k, profileId);
      if (!listGen.current.isCurrent(gen)) return;
      if (append) {
        const sig = pageSignature(r.items);
        if (sig === wfSigRef.current) setWfNoMore(true);
        wfSigRef.current = sig;
        setItems((prev) => appendUniqueItems(prev, r.items));
      } else {
        setItems(r.items);
        wfSigRef.current = pageSignature(r.items);
        setWfNoMore(r.items.length === 0);
      }
      setPageInfo({ page: r.page, pagecount: r.pagecount, total: r.total });
      setPg(page);
    } catch (e) {
      if (!listGen.current.isCurrent(gen)) return;
      setBrowseError((e as Error).message);
      if (!append) setItems([]);
    } finally {
      if (listGen.current.isCurrent(gen)) setBrowseLoading(false);
    }
  }

  async function restoreCategoryFromSession(categoryId: string, page: number, filters: Record<string, string>): Promise<void> {
    const sourceKey = keyRef.current;
    if (!sourceKey) return;
    const metadataGeneration = homeMetadataGen.current.next();
    const profileId = profileIdRef.current;
    onMemoryRestoreStartRef.current?.();
    setTid(categoryId);
    setFiltersActive(filters);
    setPg(page);
    void data.home(sourceKey, profileId)
      .then((result) => {
        if (!homeMetadataGen.current.isCurrent(metadataGeneration)) return;
        setClasses(result.sortClasses);
        setFallback(!!result.homeFallback);
      })
      .catch(() => undefined);
    await loadCategory(categoryId, page, filters);
  }

  function clearResults(): void {
    setItems([]);
  }

  function loadMoreForWaterfall(): void {
    if (aggMode || !waterfall || !tid || wfNoMore || wfBusyRef.current || browseLoading || items.length === 0) return;
    if (pageInfo.pagecount <= 1 || (pageInfo.pagecount <= 999 && pg >= pageInfo.pagecount)) return;
    wfBusyRef.current = true;
    void loadCategory(tid, pg + 1, filtersActive, true).finally(() => { wfBusyRef.current = false; });
  }

  function wfStatusText(): string {
    if (browseLoading) return '正在加载下一页…';
    if (wfNoMore) return `已加载 ${pg} 页 · 共 ${items.length} 条 · 该源已无更多新内容（可能不支持真分页）`;
    if (pageInfo.pagecount <= 999 && pg >= pageInfo.pagecount) return `已全部加载 · 共 ${items.length} 条`;
    return `已加载 ${pg} 页 · 共 ${items.length} 条 · 继续下滑自动加载`;
  }

  const waterfallObserverKey = JSON.stringify([
    key,
    tid,
    pg,
    pageInfo.pagecount,
    items.length,
    browseLoading,
    Object.entries(filtersActive).sort(([left], [right]) => left.localeCompare(right)),
  ]);
  const waterfallSentinelRef = useRef<HTMLDivElement | null>(null);
  useHomeWaterfallObserver({
    active: waterfall && !aggMode && !wfNoMore && !!tid && pageInfo.pagecount > 1,
    refreshKey: waterfallObserverKey,
    rootRef: contentRef,
    targetRef: waterfallSentinelRef,
    onVisible: loadMoreForWaterfall,
    observer: waterfallObserver,
  });

  function chooseCategory(t: string) {
    if (tid) categoryState.save(keyRef.current, tid, profileIdRef.current, { filters: filtersActive, page: waterfall ? 1 : pg });
    if (!t) {
      setTid('');
      setFiltersActive({});
      setPg(1);
      void loadCategory('', 1);
      return;
    }
    const restored = categoryState.read(keyRef.current, t, profileIdRef.current);
    const extend = restored ? restored.filters : {};
    setTid(t);
    setFiltersActive(extend || {});
    const targetPg = restored ? restored.page : 1;
    setPg(targetPg);
    void loadCategory(t, targetPg, extend || {});
  }

  function chooseFilter(gkey: string, value: string) {
    const next = { ...filtersActive };
    if (next[gkey] === value) delete next[gkey];
    else next[gkey] = value;
    setFiltersActive(next);
    categoryState.save(keyRef.current, tid, profileIdRef.current, { filters: next, page: 1 });
    void loadCategory(tid, 1, next);
  }

  function changeJumpPage(value: string): void {
    setJumpPageInput(value.replace(/[^0-9]/g, ''));
  }

  function jumpToPage(): void {
    if (browseLoading) return;
    const requestedPage = parseInt(jumpPageInput.trim(), 10);
    if (!Number.isFinite(requestedPage) || requestedPage < 1 || pageInfo.pagecount < 1) return;
    const page = pageInfo.pagecount > 999 ? requestedPage : Math.min(requestedPage, pageInfo.pagecount);
    if (page === pg) return;
    setPg(page);
    void loadCategory(tid, page, filtersActive);
  }

  function previousPage(): void {
    if (browseLoading || pg <= 1) return;
    const page = pg - 1;
    setPg(page);
    void loadCategory(tid, page, filtersActive);
  }

  function nextPage(): void {
    if (browseLoading || (pageInfo.pagecount > 0 && pageInfo.pagecount <= 999 && pg >= pageInfo.pagecount)) return;
    const page = pg + 1;
    setPg(page);
    void loadCategory(tid, page, filtersActive);
  }

  const sessionPort: HomeBrowseSessionPort = {
    activeSourceKey: () => keyRef.current,
    selectSource: (sourceKey) => {
      listGen.current.next();
      homeMetadataGen.current.next();
      keyRef.current = sourceKey;
      setKey(sourceKey);
    },
    invalidateRequests: () => {
      listGen.current.next();
      homeMetadataGen.current.next();
    },
    clear: clearBrowse,
    loadHome,
    restoreCategory: restoreCategoryFromSession,
  };

  return {
    classes,
    tid,
    filtersActive,
    items,
    pg,
    pageInfo,
    fallback,
    waterfall,
    wfSentinelRef: waterfallSentinelRef,
    wfNoMore,
    searchBrowsePort: browseSearchSession.port,
    sessionPort,
    loadHome,
    clearBrowse,
    clearResults,
    restoreSnapshot,
    loadCategory,
    chooseCategory,
    chooseFilter,
    jumpPage: jumpPageInput,
    changeJumpPage,
    jumpToPage,
    previousPage,
    nextPage,
    wfStatusText,
  };
}
