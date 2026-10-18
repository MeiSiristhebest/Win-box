import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { VodItem } from '../../../shared/types';
import { client } from '../../api/client';
import { makeStaleGuard } from '../../lib/staleGuard';
import { appendUniqueItems, pageSignature } from '../../lib/listAppend';
import { getSessionSort, setSessionSort } from '../../lib/sessionSort';
import { useWaterfall, setWaterfall as setWaterfallPref } from '../../lib/uiPrefs';

export type SortClassView = { id: string; name: string; flag?: string; filters?: import('../../../shared/types').FilterGroup[] };

type HomeBrowseControllerOptions = {
  key: string;
  setKey: Dispatch<SetStateAction<string>>;
  keyRef: MutableRefObject<string>;
  profileIdRef: MutableRefObject<string>;
  contentRef: MutableRefObject<HTMLDivElement | null>;
  loading: boolean;
  aggMode: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setErr: Dispatch<SetStateAction<string>>;
  onBrowseStart: () => void;
};

export function useHomeBrowseController({
  key,
  setKey,
  keyRef,
  profileIdRef,
  contentRef,
  loading,
  aggMode,
  setLoading,
  setErr,
  onBrowseStart,
}: HomeBrowseControllerOptions) {
  const [classes, setClasses] = useState<SortClassView[]>([]);
  const [tid, setTid] = useState('');
  const [filtersActive, setFiltersActive] = useState<Record<string, string>>({});
  const [items, setItems] = useState<VodItem[]>([]);
  const [pg, setPg] = useState(1);
  const [pageInfo, setPageInfo] = useState({ page: 0, pagecount: 0, total: 0 });
  const [wfNoMore, setWfNoMore] = useState(false);
  const [fallback, setFallback] = useState(false);
  const waterfall = useWaterfall();
  const wfBusyRef = useRef(false);
  const wfSentinelRef = useRef<HTMLDivElement | null>(null);
  const wfSigRef = useRef('');
  const listGen = useRef(makeStaleGuard());
  const prepRetryCount = useRef(0);
  const prepRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBrowseStartRef = useRef(onBrowseStart);
  onBrowseStartRef.current = onBrowseStart;

  function clearBrowse(message = '') {
    if (prepRetryTimer.current) clearTimeout(prepRetryTimer.current);
    prepRetryTimer.current = null;
    prepRetryCount.current = 0;
    listGen.current.next();
    onBrowseStartRef.current();
    keyRef.current = '';
    setKey('');
    setClasses([]);
    setTid('');
    setFiltersActive({});
    setItems([]);
    setPageInfo({ page: 0, pagecount: 0, total: 0 });
    setPg(1);
    setFallback(false);
    setLoading(false);
    setErr(message);
  }

  async function loadHome(k: string, retry = false) {
    onBrowseStartRef.current();
    if (prepRetryTimer.current) {
      clearTimeout(prepRetryTimer.current);
      prepRetryTimer.current = null;
    }
    if (!retry) prepRetryCount.current = 0;
    // A new browse request invalidates category pages and older home requests.
    const gen = listGen.current.next();
    keyRef.current = k;
    setLoading(true);
    setErr('');
    try {
      const r = await client.home(k, profileIdRef.current);
      if (!listGen.current.isCurrent(gen)) return;
      setClasses(r.sortClasses);
      setTid('');
      setFiltersActive({});
      setItems(r.items);
      setPageInfo({ page: r.page, pagecount: r.pagecount, total: r.total });
      setPg(1);
      setFallback(!!r.homeFallback);
      prepRetryCount.current = 0;
    } catch (e) {
      if (!listGen.current.isCurrent(gen)) return;
      const msg = (e as Error).message;
      setErr(msg);
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
      if (listGen.current.isCurrent(gen)) setLoading(false);
    }
  }

  useEffect(() => () => {
    if (prepRetryTimer.current) clearTimeout(prepRetryTimer.current);
    listGen.current.next();
  }, []);

  async function loadCategory(t: string, page: number, extend: Record<string, string> = {}, append = false) {
    const k = keyRef.current;
    if (!k) return;
    if (prepRetryTimer.current) {
      clearTimeout(prepRetryTimer.current);
      prepRetryTimer.current = null;
    }
    const gen = listGen.current.next();
    setLoading(true);
    setErr('');
    setFallback(false);
    try {
      const profileId = profileIdRef.current;
      const r = t
        ? await client.category({ key: k, tid: t, pg: String(page), extend: Object.fromEntries(Object.entries(extend).filter(([, value]) => value !== '')), profileId })
        : await client.home(k, profileId);
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
      setErr((e as Error).message);
      if (!append) setItems([]);
    } finally {
      if (listGen.current.isCurrent(gen)) setLoading(false);
    }
  }

  function loadMoreForWaterfall(): void {
    if (aggMode || !waterfall || !tid || wfNoMore || wfBusyRef.current || loading || items.length === 0) return;
    if (pageInfo.pagecount <= 1 || (pageInfo.pagecount <= 999 && pg >= pageInfo.pagecount)) return;
    wfBusyRef.current = true;
    void loadCategory(tid, pg + 1, filtersActive, true).finally(() => { wfBusyRef.current = false; });
  }

  function wfStatusText(): string {
    if (loading) return '正在加载下一页…';
    if (wfNoMore) return `已加载 ${pg} 页 · 共 ${items.length} 条 · 该源已无更多新内容（可能不支持真分页）`;
    if (pageInfo.pagecount <= 999 && pg >= pageInfo.pagecount) return `已全部加载 · 共 ${items.length} 条`;
    return `已加载 ${pg} 页 · 共 ${items.length} 条 · 继续下滑自动加载`;
  }

  function currentClass(): SortClassView | undefined {
    if (!tid) return undefined;
    return classes.find((c) => String(c.id) === tid);
  }

  function chooseCategory(t: string) {
    if (tid) setSessionSort(keyRef.current, tid, { filter: filtersActive, pg: waterfall ? 1 : pg }, profileIdRef.current);
    if (!t) {
      setTid('');
      setFiltersActive({});
      setPg(1);
      void loadCategory('', 1);
      return;
    }
    const restored = getSessionSort(keyRef.current, t, profileIdRef.current);
    const extend = restored ? restored.filter : {};
    setTid(t);
    setFiltersActive(extend || {});
    const targetPg = restored ? restored.pg : 1;
    setPg(targetPg);
    void loadCategory(t, targetPg, extend || {});
  }

  function chooseFilter(gkey: string, value: string) {
    const next = { ...filtersActive };
    if (next[gkey] === value) delete next[gkey];
    else next[gkey] = value;
    setFiltersActive(next);
    setSessionSort(keyRef.current, tid, { filter: next, pg: 1 }, profileIdRef.current);
    void loadCategory(tid, 1, next);
  }

  function chooseSource(k: string) {
    if (!k || k === keyRef.current) return;
    setKey(k);
    setTid('');
    setFiltersActive({});
    setItems([]);
    client.cfgSetActiveSource(k).catch(() => undefined);
    void loadHome(k);
  }

  useEffect(() => {
    if (!waterfall || aggMode || wfNoMore || !tid || pageInfo.pagecount <= 1) return;
    const root = contentRef.current;
    const sentinel = wfSentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMoreForWaterfall();
    }, { root, rootMargin: '700px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
    // Recreate the observer when paging or list state changes so a visible sentinel can fill the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterfall, aggMode, wfNoMore, tid, pg, pageInfo.pagecount, items.length, loading, filtersActive, key]);

  return {
    classes, setClasses,
    tid, setTid,
    filtersActive, setFiltersActive,
    items, setItems,
    pg, setPg,
    pageInfo, setPageInfo,
    fallback, setFallback,
    waterfall,
    wfSentinelRef,
    wfNoMore,
    listGen,
    loadHome,
    clearBrowse,
    loadCategory,
    chooseCategory,
    chooseFilter,
    chooseSource,
    currentClass,
    wfStatusText,
    setWaterfallPref,
  };
}
