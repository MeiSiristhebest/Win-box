import PosterSizeControl from '../components/PosterSizeControl';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { client } from '../api/client';
import PluginSlot from '../components/PluginSlot';
import type { SourceBean, VodItem, SearchAllReport, AggVodItem } from '../../shared/types';
import { sourceAvailability } from '../../engine/vod/sourceAvailability';
import { isDoubanLikeSource } from '../../engine/config/sourceKind';
import { sourceIdentityKey } from '../../engine/vod/aggSearch';
import { uiMem, schedulePersist, type HomeSearchMem } from '../lib/uiMemory';
import { makeStaleGuard } from '../lib/staleGuard';
import { useHomeFilters, setHomeFilters } from '../lib/uiPrefs';
import { usePageActive } from '../lib/keepAlive';
import { needsDriveBind } from '../../shared/driveProvider';
import { useCovers } from '../lib/useCovers';
import CascadeBar, { type CascadeLevel } from '../components/CascadeBar';
import DriveBindModal from '../components/DriveBindModal';
import { isSearchWindow, openSearchWindow } from '../lib/searchWin';
import { useHomeBrowseController, type SortClassView } from '../features/home/useHomeBrowseController';
import { useHomeSearchController } from '../features/home/useHomeSearchController';

export default function HomePage({ onOpenDetail }: { onOpenDetail: (key: string, id: string, pic?: string, name?: string, profileId?: string) => void }) {
  const navigate = useNavigate();
  const filtersOpen = useHomeFilters();
  const pageActive = usePageActive();
  const [jumpPg, setJumpPg] = useState('');
  const [showTopBtn, setShowTopBtn] = useState(false);
  /**
   * ★ 2026-09-24（用户定稿）：点播页**不放源内搜索与换源入口** ——
   *   三套皮肤（网飝 / 哔哔 / 大果）的顶栏/工具栏都已自带「全源搜索 + 换源」，此处再放一遍是重复。
   */
  const [sites, setSites] = useState<SourceBean[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const profileIdRef = useRef('');
  const [key, setKey] = useState('');
  const [wd, setWd] = useState('');
  /** ★ 外部入口：/search?agg=<关键词>（详情页演员/推荐、发现页卡片点击跳来）→ 自动执行一次全源搜索 */
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProfileId = (searchParams.get('profileId') || '').trim();
  /** ★ 2026-09-28：用于判断当前是否在 /search 路由（URL 同步搜索词只在该路由做，避免 /home 被改成搜索路由而重挂载） */
  const pathname = useLocation().pathname;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [profileReady, setProfileReady] = useState(false);
  // 聚合搜索态
  const [agg, setAgg] = useState<SearchAllReport | null>(null);
  const [aggMode, setAggMode] = useState(false);
  /** 搜索范围：默认只搜当前源（快）；勾选后搜全部源（慢，遍历所有可搜索源） */
  const [searchAllSources, setSearchAllSources] = useState(false);
  /** 实际执行搜索时用的范围（结果区展示用，避免用户中途改勾选导致文案错位） */
  const [aggScope, setAggScope] = useState<'current' | 'all' | 'all-profiles'>('current');
  const [searchAllProfiles, setSearchAllProfiles] = useState(false);
  /** ★ 全源搜索进度（已完成/总源数）：让用户看到「边搜边出」的推进，而不是干等 */
  const [aggProgress, setAggProgress] = useState<{ done: number; total: number; pending: number } | null>(null);
  /**
   * ★ 结果网格一次渲染多少张卡（默认 60，可「显示更多」追加）：
   *   33 源全源搜索常出上千条。**每张卡都要经主进程的本地 /img 中继取图** ——
   *   一次铺 240 张 = 240 个并发图片请求压在主进程上，进度事件与界面刷新全被挤住
   *   （用户感受：结果在出但界面「加载不出来、慢得要死」）。
   *   60 张足够铺满一屏多，其余按需追加（配合图片懒加载，只有真的滚到才发请求）。
   */
  const [aggCap, setAggCap] = useState(60);
  /** ★ 2026-09-25：全源搜索结果的「按源筛选」当前选中的源 key（'' = 全部） */
  const [aggSrc, setAggSrc] = useState('');
  /**
   * ★ 2026-09-30（用户报「其他接口的盘搜类型源搜索出来的结果无法正常展示详情」）：
   * **文件夹条目**（`vod_tag=folder`，盘搜/网盘的「夸克 (92个)」这类）的展开视图 ——
   * 点它不进详情页（详情必空），而是拿它的 id 走 `categoryContent`（`client.category`）列出内容。
   * 非空即表示当前停留在文件夹里（返回搜索/退出搜索时清空）。
   */
  /**
   * ★ 2026-09-30：**搜索代数**（见 doSearch 注释）——进文件夹 / 退出搜索 / 换源都 next() 一次，
   * 让在途的全源搜索（边搜边出）整体作废，晚到的 flush 不会顶掉用户当前看的内容。
   */
  const searchGen = useRef(makeStaleGuard());
  const keyRef = useRef('');
  /** ★ 2026-09-26：`/search?agg=` 外部入口的本轮关键词（非空即需要跑一次全源搜索） */
  const aggParam = (searchParams.get('agg') || '').trim();
  const requestedAllProfiles = searchParams.get('profiles') === 'all';
  const contentRef = useRef<HTMLDivElement>(null);
  /** ★ 2026-09-26：源内「网盘绑定」弹层开关 + 已绑定凭据（用于横幅上的状态摘要） */
  const [bindOpen, setBindOpen] = useState(false);
  const [driveTokens, setDriveTokens] = useState<Record<string, string>>({});
  /** ★ 2026-09-27：主进程学到的「需要网盘绑定」源 key（见 needsDriveBind 的第二判据） */
  const [learnedDriveKeys, setLearnedDriveKeys] = useState<string[]>([]);
  const filtersRef = useRef<Record<string, string>>({});
  /** 挂载恢复：数据就绪后回滚一次滚动位置（loadCategory 异步，须等 items 渲染） */
  const memRestoreRef = useRef(false);
  /**
   * ★ 2026-09-27（用户报「从搜索结果返回很慢、一直加载中」）：
   *   进搜索前的**浏览态快照**（当前源的首页/分类列表 + 分类骨架 + 页码/筛选/定位）。
   *   退出搜索（返回浏览）时**直接恢复它**，不再 `loadHome` —— 后者会重走
   *   `homeContent → homeVideoContent → 分类兜底` 整条链（含 .so 的 jar 单次预算 5 分钟），
   *   而这份列表用户进搜索前明明已经看过了，没有任何理由再取一次。
   */
  const browseSnapRef = useRef<{
    key: string;
    items: VodItem[];
    classes: SortClassView[];
    pageInfo: { page: number; pagecount: number; total: number };
    pg: number;
    tid: string;
    filters: Record<string, string>;
    fallback: boolean;
  } | null>(null);
  const browse = useHomeBrowseController({
    key,
    setKey,
    keyRef,
    profileIdRef,
    contentRef,
    loading,
    aggMode,
    setLoading,
    setErr,
    onBrowseStart: () => {
      setAggMode(false);
      setAgg(null);
      setHomeSearch(null);
      uiMem.home.profileId = profileIdRef.current;
      searchGen.current.next();
      browseSnapRef.current = null;
    },
  });
  const {
    classes, setClasses,
    tid, setTid,
    filtersActive, setFiltersActive,
    items, setItems,
    pg, setPg,
    pageInfo, setPageInfo,
    fallback, setFallback,
    waterfall,
    wfSentinelRef,
    listGen,
    loadHome,
    clearBrowse,
    loadCategory,
    chooseCategory,
    chooseFilter,
    chooseSource,
    currentClass,
    wfStatusText,
    wfNoMore,
  } = browse;
  const cleanExtend = (f: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  const sourceGroups = currentClass()?.filters ?? [];
  const classLevels: CascadeLevel[] = (() => {
    const out: CascadeLevel[] = [
      {
        key: 'class',
        label: '分类',
        value: tid === '' ? '' : tid,
        allLabel: '全部',
        options: classes.map((c) => ({ id: String(c.id), label: c.name })),
      },
    ];
    // ★ 2026-10-16（用户要求）：点播页**不再逐级展开** —— 开启「筛选」时把**每一行都**给出去；
    //   （逐级展开只留给发现页 —— 那边是它自己的 CascadeBar 调用，不受本处影响）
    let prevChosen = true;
    for (const g of sourceGroups) {
      if (!filtersOpen && !prevChosen) break;
      const v = filtersActive[g.key];
      out.push({
        key: `g:${g.key}`,
        label: g.name || g.key,
        value: v === undefined ? null : v,
        allLabel: '全部',
        // 源自带的空值选项（「全部/不限」）语义等同本组 allLabel → 剔掉，避免两个「全部」
        options: g.value.filter((o) => o.v !== '').map((o) => ({ id: o.v, label: o.n })),
      });
      prevChosen = v !== undefined;
    }
    return out;
  })();
  function onCascadePick(level: string, value: string): void {
    if (level === 'class') chooseCategory(value === tid ? '' : value);
    else if (level.startsWith('g:')) chooseFilter(level.slice(2), value);
  }
  function scrollToTop(): void {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function jumpToPage(): void {
    if (loading) return;
    const n = parseInt(jumpPg.trim(), 10);
    if (!Number.isFinite(n) || n < 1) return;
    const p = pageInfo.pagecount > 999 ? n : Math.min(n, pageInfo.pagecount);
    if (p === pg) return;
    setPg(p);
    void loadCategory(tid, p, filtersActive);
  }

  const search = useHomeSearchController({
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
  });
  const { applySearchMem, setProfileSearchScope, doSearch, folder, openFolder, exitFolder, exitSearch } = search;
  const coverItem = useCallback((it: VodItem, sourceKey = key) => ({
    id: `${sourceKey}\u0000${it.id}`, name: (it.name || '').split(' - ')[0].trim(),
    year: /((?:19|20)\d{2})/.exec(`${it.name} ${it.remarks || ''}`)?.[1], pic: it.pic,
  }), [key]);
  const coverProfileId = profileIdRef.current;
  const browseCoverItems = useMemo(() => items.map(it => coverItem(it)), [items, coverItem]);
  const searchCoverItems = useMemo(() => {
    const results = agg?.items || [];
    const visible = aggSrc ? results.filter(it => sourceIdentityKey(it.sourceRef?.profileId ?? coverProfileId, it.sourceKey) === aggSrc) : results;
    return visible.slice(0, aggCap).map(it => coverItem(it, sourceIdentityKey(it.sourceRef?.profileId ?? coverProfileId, it.sourceKey)));
  }, [agg, aggSrc, aggCap, coverProfileId, coverItem]);
  const covers = useCovers(browseCoverItems, pageActive && !loading && !aggMode);
  const aggCovers = useCovers(searchCoverItems, pageActive && !loading && aggMode);
  const picOf = (it: VodItem) => covers.picOf(coverItem(it));
  const aggPicOf = (it: AggVodItem) => aggCovers.picOf(coverItem(it, sourceIdentityKey(it.sourceRef?.profileId ?? profileIdRef.current, it.sourceKey)));
  const picErr = (it: VodItem) => (e: React.SyntheticEvent<HTMLImageElement>) =>
    covers.onError(coverItem(it), e.currentTarget.getAttribute('src') || '');
  const aggPicErr = (it: AggVodItem) => (e: React.SyntheticEvent<HTMLImageElement>) =>
    aggCovers.onError(coverItem(it, sourceIdentityKey(it.sourceRef?.profileId ?? profileIdRef.current, it.sourceKey)), e.currentTarget.getAttribute('src') || '');
  // 滚动/浏览状态记忆：卸载(返回)时存档，回来恢复列表定位
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      uiMem.home.scrollTop = el.scrollTop;
      // ★ 2026-10-16：只有在「越线」时改状态（其余滚动不改 state → 不触发列表重渲染，见 §C54 卡顿四件套）
      const next = el.scrollTop > 520;
      setShowTopBtn((prev) => (prev === next ? prev : next));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      uiMem.home.key = keyRef.current;
      uiMem.home.profileId = profileIdRef.current;
      schedulePersist();
    };
  }, []);
  useEffect(() => {
    return () => {
      uiMem.home.key = keyRef.current;
      uiMem.home.profileId = profileIdRef.current;
      uiMem.home.tid = tidRef.current;
      uiMem.home.pg = pgRef.current;
      uiMem.home.filters = filtersRef.current;
      schedulePersist();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据就绪后恢复滚动位置（仅恢复一次）
  useLayoutEffect(() => {
    if (!memRestoreRef.current || !contentRef.current) return;
    const top = uiMem.home.scrollTop;
    if (top > 0) contentRef.current.scrollTop = top;
    memRestoreRef.current = false;
  }, [items, loading]);

  const tidRef = useRef('');
  const pgRef = useRef(1);
  useEffect(() => {
    tidRef.current = tid;
    pgRef.current = pg;
  }, [tid, pg]);
  useEffect(() => {
    filtersRef.current = filtersActive;
  }, [filtersActive]);

  const configReadGen = useRef(makeStaleGuard());

  // 首载：优先用持久化的 ui.activeSourceKey（存在且可用则用），否则回退第一个可用源
  useEffect(() => {
    let cancelled = false;
    const configRead = configReadGen.current.next();
    const isCurrent = () => !cancelled && configReadGen.current.isCurrent(configRead);
    setProfileReady(false);
    client
      .cfgGet()
      .then(async (cfg) => {
        if (!isCurrent()) return;
        let selectedProfileId = requestedProfileId || cfg.activeProfileId;
        let s = cfg.sources;
        if (requestedProfileId && requestedProfileId !== cfg.activeProfileId) {
          s = await client.cfgProfileSources(requestedProfileId);
        }
        if (!isCurrent()) return;
        profileIdRef.current = selectedProfileId;
        setSites(s);
        setProfiles(cfg.profiles.map(({ id, name }) => ({ id, name })));
        setProfileReady(true);
        /**
         * 选出「本次应展示的源」：会话内浏览过的源（uiMem）→ 持久化选中源 → 第一个可用源。
         * ★ 2026-09-24 修复：本函数**必须在下面每个提前 return 的分支之前调用** ——
         *   此前 `/search?agg=` 分支直接 return，`key`/`keyRef` 始终为空 →
         *   ① 界面回落到 sites[0]（用户反馈「全源搜索完返回变成默认第一个源」）；
         *   ② `exitSearch()` 读 `keyRef.current` 为空 → 连首页都加载不出来。
         */
        const pickSource = (): string => {
          const memKey = uiMem.home.profileId === selectedProfileId && uiMem.home.key ? s.find((x) => x.key === uiMem.home.key) : undefined;
          if (memKey && sourceAvailability(memKey).usable) return memKey.key;
          const active = selectedProfileId === cfg.activeProfileId && cfg.ui.activeSourceKey ? s.find((x) => x.key === cfg.ui.activeSourceKey) : undefined;
          if (active && sourceAvailability(active).usable) return active.key;
          const firstUsable = s.find((x) => sourceAvailability(x).usable);
          return firstUsable ? firstUsable.key : (s[0]?.key ?? '');
        };
        // ★ 外部入口：/search?agg=<关键词> —— 详情页「演员 / 相关推荐」与发现页卡片点击后跳来，
        //   自动跑一次全源搜索。**具体执行在下面的 aggParam effect**（这样「已在搜索页再次搜索」
        //   也能触发：同路由只变 query 不会重挂载，旧实现写在首载 effect 里 → 第二次搜索毫无反应）。
        if (aggParam) {
          // ★ 2026-09-28：**不再清掉参数** —— 让 URL 保留本次关键词（返回/前进天然正确，见 syncSearchUrl）。
          //   是否要真正发起搜索由下面的 aggParam effect 决定（内存已有同词结果时只恢复、不重搜）。
          setWd(aggParam);
          setSearchAllSources(true);
          setSearchAllProfiles(requestedAllProfiles);
          // 先把「搜索前的源」定下来（只置状态、不拉首页数据，搜索视图不需要），
          // 这样退出搜索（返回浏览）能准确回到原源与原列表。
          const pick = pickSource();
          if (pick) {
            setKey(pick);
            keyRef.current = pick;
          }
          return;
        }
        // ★ 搜索 → 详情 → 返回：恢复上次搜索结果界面（不重新浏览首页）
        const memSearch = uiMem.home.search;
        if (isSearchWindow() && memSearch && memSearch.aggMode && memSearch.profileId === selectedProfileId && !!memSearch.searchAllProfiles === requestedAllProfiles) {
          applySearchMem(memSearch);
          const pick = pickSource();
          if (pick) {
            setKey(pick);
            keyRef.current = pick;
          }
          return;
        }
        if (s.length === 0) {
          clearBrowse('尚未导入站源，请先到「配置」页导入');
          return;
        }
        const pick = pickSource();
        if (pick) {
          setKey(pick);
          const mem = uiMem.home;
          const useMem = mem.profileId === selectedProfileId && mem.key === pick && (mem.tid !== '' || mem.pg > 1);
          if (useMem && mem.tid) {
            // ★ 恢复到"刚看到封面的分类页"：分类 tab + 分类 + 页码 + 筛选 全部恢复
            keyRef.current = pick; // loadCategory 依赖 keyRef，先前为空导致恢复分支不加载
            memRestoreRef.current = true;
            // 分类列表独立拉取（恢复分类页时不被 loadHome 清空 tid）
            client
              .home(pick, selectedProfileId)
              .then((h) => { if (isCurrent()) { setClasses(h.sortClasses); setFallback(!!h.homeFallback); } })
              .catch(() => undefined);
            setTid(mem.tid);
            setFiltersActive(mem.filters || {});
            setPg(mem.pg || 1);
            void loadCategory(mem.tid, mem.pg || 1, cleanExtend(mem.filters || {}));
          } else {
            void loadHome(pick);
          }
        }
      })
      .catch((e) => {
        if (isCurrent()) {
          setErr((e as Error).message);
          setProfileReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedProfileId]);

  const pendingProfileRef = useRef(false);
  const preferredSourceRef = useRef('');
  const everActiveRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const configGeneration = configReadGen.current;
    const refresh = (force = false): void => {
      if (requestedProfileId) return;
      if (!pageActive) {
        pendingProfileRef.current = true;
        configReadGen.current.next();
        return;
      }
      const request = configReadGen.current.next();
      const reload = force || pendingProfileRef.current;
      const preferred = preferredSourceRef.current;
      void client.cfgGet().then((cfg) => {
        if (!alive || !configReadGen.current.isCurrent(request)) return;
        const profileChanged = profileIdRef.current !== cfg.activeProfileId;
        profileIdRef.current = cfg.activeProfileId;
        setSites(cfg.sources);
        setProfiles(cfg.profiles.map(({ id, name }) => ({ id, name })));
        setProfileReady(true);
        const desired = preferred || cfg.ui.activeSourceKey || (!profileChanged ? keyRef.current : '');
        const source = cfg.sources.find(item => item.key === desired && sourceAvailability(item).usable)
          ?? cfg.sources.find(item => sourceAvailability(item).usable)
          ?? cfg.sources[0];
        pendingProfileRef.current = false;
        preferredSourceRef.current = '';
        if (!source) {
          clearBrowse('尚未导入站源，请先到「配置」页导入');
          return;
        }
        if (reload || profileChanged || source.key !== keyRef.current) {
          setKey(source.key);
          void loadHome(source.key);
        }
      }).catch((cause: unknown) => {
        if (alive && configReadGen.current.isCurrent(request)) {
          setProfileReady(true);
          setErr(cause instanceof Error ? cause.message : String(cause));
        }
      });
    };
    const onProfile = (event: Event): void => {
      if (requestedProfileId) return;
      pendingProfileRef.current = true;
      const detail: unknown = (event as CustomEvent).detail;
      preferredSourceRef.current = typeof detail === 'string' ? detail : '';
      listGen.current.next();
      searchGen.current.next();
      refresh(true);
    };
    const onSources = (): void => refresh();
    const onSource = (event: Event): void => {
      const key: unknown = (event as CustomEvent).detail;
      if (pageActive && !requestedProfileId && typeof key === 'string' && key) chooseSource(key);
    };
    if (pageActive) {
      if (everActiveRef.current || pendingProfileRef.current) refresh();
      everActiveRef.current = true;
    }
    window.addEventListener('winbox:profile-changed', onProfile);
    window.addEventListener('winbox:sources-changed', onSources);
    window.addEventListener('winbox:source-changed', onSource);
    window.addEventListener('focus', onSources);
    return () => {
      alive = false;
      configGeneration.next();
      window.removeEventListener('winbox:profile-changed', onProfile);
      window.removeEventListener('winbox:sources-changed', onSources);
      window.removeEventListener('winbox:source-changed', onSource);
      window.removeEventListener('focus', onSources);
    };
    // Loading actions read the current source/profile refs and invalidate older requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageActive, requestedProfileId]);

  /**
   * 搜索。
   * - 默认（searchAllSources=false）：只搜当前选中源 —— 快，行为与上游 TVBox 的
   *   `filter__home` 模式一致（切换源即切换搜索范围）。
   * - 勾选「全源搜索」：遍历全部可搜索源并发检索（调度位 12 + 池并行 8），结果**边搜边出**。
   * - ★ 2026-09-23 三轮：同关键词 5 分钟内再搜 → 主进程直接返回本地缓存（**秒回**）；
   *   `force=true`（「重新搜索」按钮）忽略缓存强制重搜。
   */
  /**
   * 更新「上次搜索态」并**打版本号**：`updatedAt` 让更新的那份在跨窗口合并中胜出
   * （`loadUiMemory` 会被挂载 / 窗口 focus / visibility 触发，旧值不能把新搜索顶掉 —— 见 `HomeMem.updatedAt`）。
   */
  function setHomeSearch(next: HomeSearchMem | null) {
    const profileId = next?.profileId ?? profileIdRef.current;
    uiMem.home.search = next ? { ...next, profileId } : null;
    uiMem.home.profileId = profileId;
    uiMem.home.updatedAt = Date.now();
  }

  const failed = useMemo(() => agg?.perSource.filter((p) => p.status === 'error') ?? [], [agg]);
  const isWideSearch = aggScope === 'all' || aggScope === 'all-profiles';
  const resultProfileId = profileIdRef.current;
  /**
   * ★ 2026-09-25（用户要求）：全源搜索结果**顶部按源筛选** —— 只展示某个源的结果。
   *   筛选条只在「全源搜索 + 命中 ≥2 个源」时出现（单源搜索时它没有意义）。
   */
  const aggSrcChips = useMemo(() => {
    if (!agg || !isWideSearch) return [];
    const sourcesByIdentity = new Map(agg.perSource.map(source => [sourceIdentityKey(source.profileId ?? resultProfileId, source.key), source]));
    const profileNames = new Map(profiles.map(profile => [profile.id, profile.name]));
    const n = new Map<string, { key: string; profileId: string; count: number }>();
    for (const it of agg.items) {
      const profileId = it.sourceRef?.profileId ?? resultProfileId;
      const identity = sourceIdentityKey(profileId, it.sourceKey);
      const entry = n.get(identity) ?? { key: it.sourceKey, profileId, count: 0 };
      entry.count++;
      n.set(identity, entry);
    }
    return [...n.entries()]
      .map(([identity, entry]) => {
        const perSource = sourcesByIdentity.get(identity);
        const profileName = perSource?.profileName || profileNames.get(entry.profileId);
        const sourceName = perSource?.name || entry.key;
        return {
          identity,
          n: entry.count,
          name: aggScope === 'all-profiles' && profileName ? `${profileName} · ${sourceName}` : sourceName,
        };
      })
      .sort((a, b) => b.n - a.n);
  }, [agg, isWideSearch, resultProfileId, profiles, aggScope]);
  /** 按源筛选后的结果（网格 / 计数 / 「显示更多」都用它） */
  const aggView = useMemo(() => aggSrc
    ? (agg?.items || []).filter((it) => sourceIdentityKey(it.sourceRef?.profileId ?? resultProfileId, it.sourceKey) === aggSrc)
    : agg?.items || [], [agg, aggSrc, resultProfileId]);
  /** 切换筛选 = 换一屏结果 → 分页计数复位 */
  const pickAggSrc = (k: string): void => {
    setAggSrc(k);
    setAggCap(60);
  };
  /** 当前源：站级样式（style=海报/列表）与预设分类（categories）随源切换生效 */
  const curSite = sites.find((s) => s.key === key) ?? (key ? undefined : sites[0]);
  const listStyle = !!curSite?.style && /list/i.test(curSite.style);
  const siteCats = curSite?.categories?.filter(Boolean) ?? [];
  /**
   * ★ 2026-09-29（用户要求）：豆瓣类源**本质是搜索聚合**（蜘蛛只有 searchContent，
   *   detailContent 为空或仅简介）⇒ 点封面**不进详情页**，改成拿片名做一次全源聚合搜索，
   *   让用户直接换到「能出剧集」的源。非豆瓣源保持原行为（进详情）。
   */
  const goAggSearch = (name: string, profileId = profileIdRef.current || requestedProfileId || undefined): void => {
    void openSearchWindow(name, profileId, searchAllProfiles).catch((e) => setErr(String(e)));
  };
  const openItem = (it: VodItem): void => {
    if (it.tag === 'folder') { void openFolder(it.sourceRef?.key || key, it.id, it.name, it.sourceRef?.profileId ?? profileIdRef.current); return; }
    if (isDoubanLikeSource(curSite)) { goAggSearch(it.name); return; }
    onOpenDetail(it.sourceRef?.key || key, it.id, it.pic || '', it.name, it.sourceRef?.profileId ?? profileIdRef.current);
  };
  /**
   * ★ 2026-09-30（瀑布模式配套，防卡顿）：给 memo 卡片用的**稳定身份**回调 ——
   *   `openItem` / `picErr` 每次渲染都是新函数（读的 state 也多），直接当 props 会让 memo 失效；
   *   这里用 ref 指向「最新那份」，对外只暴露恒定的包装函数（调用时永远是最新闭包，语义不变）。
   */
  const openItemRef = useRef(openItem);
  useEffect(() => { openItemRef.current = openItem; });
  const openItemStable = useCallback((it: VodItem) => openItemRef.current(it), []);
  const picErrRef = useRef(picErr);
  useEffect(() => { picErrRef.current = picErr; });
  const handleImgErr = useCallback((it: VodItem, e: React.SyntheticEvent<HTMLImageElement>) => picErrRef.current(it)(e), []);
  /** 聚合搜索结果卡：来自豆瓣类源的条目同样直接全源搜索（它自己的详情必空） */
  const openAggItem = (it: AggVodItem): void => {
    const sourceProfileId = it.sourceRef?.profileId ?? profileIdRef.current;
    const sourceKey = it.sourceRef?.key || it.sourceKey;
    if (it.tag === 'folder') {
      void openFolder(sourceKey, it.id, it.name, sourceProfileId);
      return;
    }
    void (async () => {
      let site = sourceProfileId === profileIdRef.current ? sites.find((source) => source.key === sourceKey) : undefined;
      if (!site && sourceProfileId) {
        try { site = (await client.cfgProfileSources(sourceProfileId)).find((source) => source.key === sourceKey); } catch { /* Detail navigation can still use the source reference. */ }
      }
      if (isDoubanLikeSource(site)) { goAggSearch(it.name, sourceProfileId); return; }
      onOpenDetail(sourceKey, it.id, it.pic || '', it.name, sourceProfileId);
    })();
  };
  const openAggItemRef = useRef(openAggItem);
  useEffect(() => { openAggItemRef.current = openAggItem; });
  const openAggItemStable = useCallback((it: AggVodItem) => openAggItemRef.current(it), []);
  const aggPicErrRef = useRef(aggPicErr);
  useEffect(() => { aggPicErrRef.current = aggPicErr; });
  const handleAggImgErr = useCallback((it: AggVodItem, event: React.SyntheticEvent<HTMLImageElement>) => aggPicErrRef.current(it)(event), []);
  /**
   * ★ 2026-09-26（用户要求）：**源内网盘绑定** —— 该源是否靠网盘 Cookie 取流（ext 带 Cloud-drive
   *   或蜘蛛类属网盘家族）。是则在源主页给一条横幅 +「网盘绑定」入口，不用再去点源里的「配置」源。
   */
  /**
   * ★ 2026-09-27（用户要求「确保每一个需要绑定网盘的都能有这段提示，不管换什么订阅什么源」）：
   *   判定用 `needsDriveBind`（静态类名/ext 判据 ∪ **主进程运行期学到的**源 key）。
   *   学习点 = 主进程 `play()` 里蜘蛛真实产出网盘直链 → 记入 `<userData>/drive-bind-learned.json`，
   *   所以「摸鱼版立播（`csp_Libvio` + `ext={"site":[…]}`）之类清单漏网」也能在首次播放后被覆盖。
   */
  const driveSrc = needsDriveBind(curSite, learnedDriveKeys);
  /**
   * ★ 2026-09-29（用户要求）本地包「网页源」：该源带 `homePage`（包内 html 首页，靠 window.fm 桥拉数据）
   *   → 点播页顶部给一条横幅 +「打开网页」入口，在独立窗口里打开（见 main/webbridge/WebHomeWindow.ts）。
   */
  const homePageUrl = (curSite?.homePage || '').trim();
  const openWebHome = async (): Promise<void> => {
    setErr('');
    try {
      const r = await client.webHomeOpen({
        url: homePageUrl,
        title: `${curSite?.name || '网页源'} · 网页`,
        site: { key: curSite?.key, name: curSite?.name, api: curSite?.api, ext: curSite?.ext, homePage: homePageUrl },
      });
      if (!r.ok && r.error) setErr(r.error);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const boundDriveNames = ['quark', 'uc', 'baidu', 'ali', '115', 'bili']
    .filter((p) => driveTokens[p])
    .map((p) => ({ quark: '夸克', uc: 'UC', baidu: '百度', ali: '阿里', '115': '115', bili: '哔哩' } as Record<string, string>)[p]);
  // 进入网盘类源时拉一次绑定状态（保存后由弹层回调刷新）
  const refreshDriveTokens = (): void => {
    void client.driveGet().then(setDriveTokens).catch(() => undefined);
  };
  useEffect(() => {
    if (driveSrc) refreshDriveTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveSrc]);
  /**
   * 学习结果的刷新时机：① 挂载；② 源列表变化；③ **窗口重新获得焦点** ——
   * 播放器里点「去点播页绑定」时主进程会把主窗口 focus 起来（IPC.UI_GOTO_DRIVE_BIND），
   * 这里据此拿到刚学到的那条，横幅才会即时出现（不必重启）。
   */
  useEffect(() => {
    const load = (): void => {
      void client.driveBindKeys().then(setLearnedDriveKeys).catch(() => undefined);
    };
    load();
    const onFocus = (): void => load();
    const onSources = (): void => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('winbox:sources-changed', onSources);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('winbox:sources-changed', onSources);
    };
  }, []);

  return (
    <>
      {/**
        * ★ 2026-09-24（用户定稿）：三套皮肤（网飝 / 哔哔 / 大果）的顶栏都已自带「全源搜索 + 换源」——
        *   浏览态整行不显示（避免重复）；仅「全源搜索结果态」保留（需要「返回浏览」出口与条数状态）。
        */}
      {aggMode && !isSearchWindow() && (
      <div className="topbar">
        {folder ? (
          // ★ 2026-09-30：文件夹视图的出口 —— 回到上一层搜索结果（不重跑搜索；无快照时命中搜索缓存）
          <button onClick={exitFolder}>← 返回搜索</button>
        ) : (
          <button onClick={exitSearch}>返回浏览</button>
        )}
        <span className="status" style={{ marginLeft: 'auto' }}>
          {loading
            ? isWideSearch
              ? `${aggScope === 'all-profiles' ? '跨档案搜索' : '全源搜索'}中…${aggProgress ? `已出 ${aggProgress.done}/${aggProgress.total} 个源的结果${aggProgress.pending > 0 ? ` · 其余 ${aggProgress.pending} 个仍在补搜（出现即自动加上）` : ''}` : '（遍历全部源，结果边搜边出）'}`
              : folder ? `正在展开「${folder.name}」…` : '搜索中…'
            : folder
              ? `「${folder.name}」${agg?.items.length ?? 0} 条`
              : `命中 ${agg?.items.length ?? 0} 条`}
        </span>
      </div>
      )}
      <div className="content home-content" ref={contentRef}>
        {!aggMode && <header className="page-heading">
          <div><h1>点播</h1><p>{curSite ? `当前站点：${curSite.name || curSite.key}` : '导入订阅后，在这里浏览和播放内容。'}</p></div>
          <PosterSizeControl />
        </header>}
        {aggMode && <div className="gallery-toolbar"><PosterSizeControl /></div>}
        {/* ★ 2026-10-18 插件受限 UI 槽位（`contributes.ui.slot`；无插件声明时零影响） */}
        <PluginSlot slot="home" />
        {isSearchWindow() && folder && <button style={{ marginBottom: 12 }} onClick={exitFolder}>← 返回搜索结果</button>}
        {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
        {!err && fallback && !aggMode && (
          <div className="banner" style={{ borderLeftColor: 'var(--accent-2)', marginBottom: 12 }}>
            当前展示首个分类的内容，可在下方切换分类。
          </div>
        )}
        {/* ★ 2026-09-26：网盘类源 → 源内绑定入口（替代「源内配置源」：cookie 直接配在应用里） */}
        {driveSrc && !aggMode && (
          <div
            className="banner"
            style={{ borderLeftColor: boundDriveNames.length ? 'var(--accent-2)' : 'var(--warn)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span>
              该源用网盘取流：
              {boundDriveNames.length ? `已绑定「${boundDriveNames.join('/')}」` : '尚未绑定网盘 Cookie'}
              {boundDriveNames.length ? '' : '，绑定后本源才能列出/播放盘内资源'}。
            </span>
            <button className="primary" onClick={() => setBindOpen(true)}>网盘绑定</button>
          </div>
        )}
        {/* ★ 2026-09-29（用户要求）本地包「网页源」：该源首页是一张自带 Web UI 的 html → 独立窗口打开 */}
        {homePageUrl && !aggMode && (
          <div
            className="banner"
            style={{ borderLeftColor: 'var(--accent-2)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span>该源是网页源（自带网页界面）：列取/登录等交互在网页窗口里完成，起播仍由本应用接管。</span>
            <button className="primary" onClick={() => void openWebHome()}>打开网页</button>
          </div>
        )}

        {isSearchWindow() && aggMode && !folder && profiles.length > 1 && (
          <div className="banner" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={searchAllProfiles}
                disabled={!profileReady}
                onChange={(event) => setProfileSearchScope(event.target.checked)}
              />
              搜索全部订阅档案（{profiles.length}）
            </label>
            <span className="muted" style={{ fontSize: 12 }}>同名源按档案分别显示</span>
          </div>
        )}

        {aggMode ? (
          agg && !err ? (
            <>
              {/* 汇总条 */}
              {folder ? (
                // ★ 2026-09-30：文件夹视图（盘搜的「夸克 (92个)」）—— 内容来自 categoryContent，
                //   条目就是网盘分享链接，点进去才是正常的详情页（剧集/文件列表）
                <div className="banner" style={{ borderLeftColor: agg.items.length ? 'var(--accent-2)' : 'var(--warn)' }}>
                  📁「{folder.name}」共 {agg.items.length} 条 · 来自「{folder.sourceName || folder.key}」
                  <span className="muted">（点条目查看内容；点左上「← 返回搜索」回到搜索结果）</span>
                </div>
              ) : (
              <div className="banner" style={{ borderLeftColor: agg.items.length ? 'var(--accent-2)' : 'var(--warn)' }}>
                {isWideSearch ? (
                  <>
                    {aggScope === 'all-profiles'
                      ? `「${wd}」共搜 ${profiles.length} 个订阅档案、${agg.perSource.length} 个源`
                      : `「${wd}」共搜 ${agg.perSource.length} 个源`}
                    ：命中 {agg.hitSources} 个 · 共 {agg.items.length} 条（各源分别列出，不合并）
                    {agg.failedSources > 0 ? ` · ⚠ ${agg.failedSources} 个源出错（见下）` : ''}
                    {/* ★ 缓存秒回提示：这次结果是本机缓存（5 分钟内搜过同一关键词）→ 给一个「重新搜索」 */}
                    {agg.pendingSources ? (
                      <div style={{ marginTop: 6 }}>
                        ⏳ {agg.pendingSources} 个源正在准备运行时（首次下载/转换 jar：小 jar 约 10~40 秒，大 jar 可能需数分钟），本次未参与 —— 会自动重搜（每 30 秒一次，最多 6 分钟）；也可以点
                        <button className="linkbtn" style={{ margin: '0 4px' }} onClick={() => void doSearch(true)}>立即重搜</button>
                      </div>
                    ) : null}
                    {agg.cachedAt ? (
                      <span className="muted">
                        {' '}· 本地缓存（{Math.max(1, Math.round((Date.now() - agg.cachedAt) / 60000))} 分钟前）
                        <button className="linkbtn" style={{ marginLeft: 6 }} onClick={() => void doSearch(true)}>重新搜索</button>
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    在「{agg.perSource[0]?.name ?? key}」中搜「{wd}」：{agg.items.length} 条
                    {agg.items.length === 0 && (
                      <span className="muted"> —— 没找到？勾选上方「全源搜索」再试一次</span>
                    )}
                  </>
                )}
              </div>
              )}

              {/* ★ 按源筛选条（全源搜索命中 ≥2 源时出现）：点一下只看该源的结果 */}
              {aggSrcChips.length > 1 && (
                <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap', rowGap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>按源筛选：</span>
                  <button type="button"
                    className={`tag ui-action ${aggSrc === '' ? 'active' : ''}`}
                    aria-pressed={aggSrc === ''}
                    title={`全部源 · ${agg.items.length} 条`}
                    onClick={() => pickAggSrc('')}
                  >
                    全部 {agg.items.length}
                  </button>
                  {aggSrcChips.map((c) => (
                    <button type="button"
                      key={c.identity}
                      className={`tag ui-action ${aggSrc === c.identity ? 'active' : ''}`}
                      aria-pressed={aggSrc === c.identity}
                      title={`${c.name} · ${c.n} 条`}
                      onClick={() => pickAggSrc(c.identity)}
                    >
                      {c.name} {c.n}
                    </button>
                  ))}
                </div>
              )}

              {aggView.length > 0 ? (
                <>
                  {/* 结果网格：★ 默认只渲染前 aggCap 张卡（33 源全源搜索常出上千条，
                      整屏 DOM 一多，每次进度刷新都要重排几百个 <img> → 界面「卡着不动」）；
                      「显示更多」按需追加，保证边搜边出的每次刷新都是毫秒级。 */}
                  <div className="grid">
                    {aggView.slice(0, aggCap).map((it) => (
                      <AggCard
                        key={`${sourceIdentityKey(it.sourceRef?.profileId ?? profileIdRef.current, it.sourceKey)}-${it.id}`}
                        it={it}
                        pic={aggPicOf(it)}
                         onErr={handleAggImgErr}
                         onOpen={openAggItemStable}
                      />
                    ))}
                  </div>
                  {aggView.length > aggCap && (
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                      <button onClick={() => setAggCap((n) => n + 240)}>显示更多（还有 {aggView.length - aggCap} 条）</button>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty">
                  {folder
                    ? `「${folder.name}」里没有可展示的条目。`
                    : aggSrc
                      ? `该源没有「${wd}」的匹配结果。`
                      : isWideSearch
                        ? `${aggScope === 'all-profiles' ? '全部订阅档案' : '全部源'}均无「${wd}」的匹配结果。`
                        : `当前源无「${wd}」的匹配结果。`}
                  {agg.failedSources > 0 && (
                    <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                      其中 {agg.failedSources} 个源查询出错，可能掩盖了结果，请参照下方异常列表重试或更换关键词。
                    </div>
                  )}
                </div>
              )}

              {failed.length > 0 && (
                <div className="card" style={{ padding: 12, marginTop: 14 }}>
                  <h4 style={{ margin: '0 0 8px', color: 'var(--warn)' }}>
                    {isWideSearch ? '⚠ 以下源查询出错（不影响其它源结果）' : '⚠ 搜索出错'}
                  </h4>
                  <div style={{ fontSize: 12, lineHeight: 1.9 }}>
                    {failed.map((p) => (
                      <div key={sourceIdentityKey(p.profileId ?? profileIdRef.current, p.key)}>
                        {p.profileName && aggScope === 'all-profiles' ? <><b>{p.profileName} · </b></> : null}<b>{p.name}</b> <span className="muted">({p.key})</span>：<span style={{ color: 'var(--text-dim)' }}>{p.error || '未知错误'}</span>
                      </div>
                    ))}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                    常见原因：源站失效/超时/需 ext。可到「配置」页对该源点「诊断」查看详情。
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty">
              {loading
                ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    {folder
                      ? `正在展开「${folder.name}」…`
                      : isWideSearch
                        ? `${aggScope === 'all-profiles' ? '正在跨档案逐源检索' : '正在逐源检索'}${aggProgress ? `（已出 ${aggProgress.done}/${aggProgress.total} 个源的结果${aggProgress.pending > 0 ? `，其余 ${aggProgress.pending} 个仍在补搜` : ''}）` : '（首次调用 jar 蜘蛛较慢）'}，请稍候…`
                        : '搜索中…'}
                  </>
                )
                : err
                  ? '搜索/展开失败：见上方错误信息'
                  : '搜索中，请稍候…'}
            </div>
          )
        ) : (
          <>
            {/* ★ 2026-10-16（用户要求）：点播页的分类/筛选条由「筛选」按钮开关 ——
                ★ 二次调整：「**分类」那一列始终显示**（与「筛选」按钮同一水平线），
                  点「筛选」后才在**下面**弹出其余全部筛选组（剧情/地区/年份/排序…）；
                  按钮右下角在开启态出现对号；该偏好持久化 ⇒ 换源/重启后仍保持。 */}
            {classes.length > 0 && !err && (
              <div className="row home-filter-row">
                {/* ★ 2026-10-16（用户要求）：**「分类」那一列始终显示**，且与「筛选」按钮**同一水平线**；
                    点「筛选」后**下面**再弹出其余全部筛选组（见下方 `.home-filters-more`）。
                    ⇒ 这里只给 `classLevels` 的**第一级（分类）**，其余级留给下面那块。 */}
                <CascadeBar levels={classLevels.slice(0, 1)} onPick={onCascadePick} />
                {/* 按钮固定在这行右侧（与上面「分类」同一水平线）；未选分类时源没有筛选组可展开，
                    按它只切状态（与旧版一致）——保持"筛选永远在分类行右边"的可预期性。 */}
                <button
                  type="button"
                  className={`home-filter-btn${filtersOpen ? ' active' : ''}`}
                  aria-pressed={filtersOpen}
                  title={filtersOpen ? '收起源的筛选条件' : '展开源的筛选条件'}
                  onClick={() => setHomeFilters(!filtersOpen)}
                >
                  {/* 筛选（漏斗）图标 —— 与「收藏」按钮同口径：内联 SVG，随按钮前景色 */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 4h18l-7.2 8.4V19l-3.6-2.2v-4.4z" />
                  </svg>
                  筛选
                  {filtersOpen && <span className="hf-check" aria-hidden="true">✓</span>}
                </button>
              </div>
            )}
            {/* ★ 2026-10-15（用户要求「级联分类·保留源分类」）：分类条 + 该分类的筛选组。
                ★ 2026-10-16 调整：「分类」那一级已挪到上面、与「筛选」按钮同行常驻（`levels.slice(0,1)`），
                  这里只负责点「筛选」后**在下面弹出**其余全部筛选组（剧情/地区/年份/排序…）；
                  **发现页仍走它自己的逐级展开**，不受影响。 */}
            {classes.length > 0 && !err && filtersOpen && classLevels.length > 1 && (
              <div className="home-filters-more">
                <CascadeBar levels={classLevels.slice(1)} onPick={onCascadePick} />
              </div>
            )}
            {/* 站级预设分类（SourceBean.categories）：映射到同名/同 id 分类则点击可切，否则只读展示（随「筛选」一并显隐） */}
            {siteCats.length > 0 && !err && filtersOpen && (
              <div className="row" style={{ marginBottom: 14 }}>
                <span className="muted" style={{ fontSize: 11, marginRight: 6 }}>预设分类：</span>
                {siteCats.map((c) => {
                  const m = classes.find((x) => x.name === c || String(x.id) === c);
                  return (
                    <button type="button"
                      key={c}
                      className={`tag ui-action ${m && String(m.id) === tid ? 'active' : ''}`}
                      aria-pressed={Boolean(m && String(m.id) === tid)}
                      onClick={() => chooseCategory(m ? String(m.id) : '')}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            )}
            {items.length === 0 ? (
              <div className="empty">
                {loading
                  ? '加载中…'
                  : sites.length === 0
                    ? <><h2>添加你的第一个订阅</h2><p>支持单仓、多仓和本地配置文件。</p><button className="primary" onClick={() => { try { localStorage.setItem('winbox-cfg-tab', 'sources'); } catch { /* Storage may be disabled. */ } navigate('/config'); }}>导入订阅</button></>
                    : err
                      ? '加载失败，请查看上方错误提示'
                      : <><h2>当前站点暂无内容</h2><p>可以切换分类、在左侧更换站点，或使用顶部搜索。</p></>}
              </div>
            ) : (
              <>
                {listStyle ? (
                  <div className="list">
                    {items.map((it) => (
                      <button type="button" key={it.id} className="list-item ui-action" aria-label={`打开 ${it.name}`} onClick={() => openItem(it)}>
                        {picOf(it) ? <img src={picOf(it)} alt={it.name} onError={picErr(it)} loading="lazy" decoding="async" /> : <div className="no-cover" style={{ width: 42, height: 58, flex: '0 0 auto', textAlign: 'center' }}>暂无封面</div>}
                        <span className="li-name" title={it.name}>{it.name}</span>
                        {it.remarks && <span className="badge">{it.remarks}</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                <div className="grid">
                  {items.map((it) => (
                    <VodCard key={it.id} it={it} pic={picOf(it)} onOpen={openItemStable} onImgErr={handleImgErr} />
                  ))}
                </div>
                )}
                {/* ★ 2026-09-30（瀑布模式）：底部哨兵 —— 进入预取范围即自动追加下一页（见上方 effect） */}
                {waterfall && tid !== '' && pageInfo.pagecount > 1 && (
                  <div ref={wfSentinelRef} style={{ height: 1 }} aria-hidden="true" />
                )}
                {pageInfo.pagecount > 1 && (waterfall && tid !== '' ? (
                  // 瀑布模式：底部只留进度（加载由哨兵自动驱动，无需按钮；模式切换在「配置 → 外观」）
                  <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                    <span className="status">{wfStatusText()}</span>
                  </div>
                ) : (
                  <div className="row" style={{ justifyContent: 'center', marginTop: 16, flexWrap: 'wrap', rowGap: 8 }}>
                    <button disabled={pg <= 1 || loading} onClick={() => { const p = pg - 1; setPg(p); loadCategory(tid, p, filtersActive); }}>上一页</button>
                    {/* ★ 2026-10-16：`wfNoMore`（本页零新增 ⇒ 源其实没有更多页）同样禁用「下一页」并把状态说清楚 */}
                    <span className="status">{wfNoMore ? `${pg} 页 · 已到底（该源无更多内容）` : pageInfo.pagecount > 999 ? `${pg} 页` : `${pg} / ${pageInfo.pagecount}`}</span>
                    <button disabled={pg >= pageInfo.pagecount || loading || wfNoMore} onClick={() => { const p = pg + 1; setPg(p); loadCategory(tid, p, filtersActive); }}>下一页</button>
                    {/* ★ 2026-10-16（用户要求「翻页增加输入页码快速跳页」）：只在有真分页语义的分类里给（tid='' 走 home 接口无页码） */}
                    {tid !== '' && (
                      <>
                        <input
                          className="pg-jump"
                          type="text"
                          inputMode="numeric"
                          value={jumpPg}
                          placeholder="页码"
                          aria-label="跳至指定页码"
                          onChange={(e) => setJumpPg(e.target.value.replace(/[^0-9]/g, ''))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) jumpToPage(); }}
                        />
                        <button disabled={loading || jumpPg.trim() === ''} onClick={jumpToPage} title="跳到输入的页码">跳页</button>
                      </>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
      {/* ★ 2026-10-16（用户要求）：瀑布模式下右下角「回到顶部」浮钮（下滚一定距离才出现，见 scroll 监听） */}
      {waterfall && showTopBtn && !aggMode && (
        <button className="btn-to-top" title="回到顶部" aria-label="回到顶部" onClick={scrollToTop}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
      {/* ★ 2026-09-26：源内网盘绑定弹层（保存后刷新绑定状态 + 重载本源首页，让新 cookie 立即生效） */}
      {bindOpen && curSite && (
        <DriveBindModal
          siteName={curSite.name || curSite.key}
          onClose={() => setBindOpen(false)}
          onSaved={() => {
            refreshDriveTokens();
            const k = keyRef.current;
            if (k) void loadHome(k);
          }}
        />
      )}
    </>
  );
}

/**
 * ★ 2026-09-30（瀑布模式配套，防卡顿）：点播网格卡抽成 **memo** 组件 ——
 *   追加一页时，已显示的几百张卡 props 全不变（`pic` 是解析后的字符串、两个回调身份恒定）
 *   → React 直接跳过它们的渲染，只渲染新入页的卡。此前整张列表内联在本页，
 *   任何 state 变化（loading / 补图 / 翻页）都要重建全部卡片 —— 瀑布连翻十几页时的卡顿主因。
 *   渲染成本再叠一层 CSS：`.grid .card-media { content-visibility: auto }`（只渲染可视区，见 global.css）。
 */
const VodCard = memo(function VodCard({
  it, pic, onOpen, onImgErr,
}: {
  it: VodItem;
  pic: string;
  onOpen: (it: VodItem) => void;
  onImgErr: (it: VodItem, e: React.SyntheticEvent<HTMLImageElement>) => void;
}) {
  return (
    <button type="button" className="card-media ui-action card-media-button" aria-label={`打开 ${it.name}`} onClick={() => onOpen(it)}>
      <div className="card">
        <div style={{ position: 'relative' }}>
          {/* ★ 空封面（搜索未命中 + 源图坏）→ 渲染占位块，绝不渲染坏图/灰影 */}
          {pic
            ? <img src={pic} alt={it.name} onError={(e) => onImgErr(it, e)} loading="lazy" decoding="async" />
            : <div className="no-cover">暂无封面</div>}
          {it.remarks && <span className="badge">{it.remarks}</span>}
        </div>
        <div className="meta">
          <div className="name" title={it.name}>{it.name}</div>
        </div>
      </div>
    </button>
  );
});

/** 聚合结果卡：带来源徽标；同片多源提示；点击进对应源详情（pic 由外部注入 = TMDB 补全优先） */
const AggCard = memo(function AggCard({ it, pic, onOpen, onErr }: { it: AggVodItem; pic: string; onOpen: (it: AggVodItem) => void; onErr: (it: AggVodItem, e: React.SyntheticEvent<HTMLImageElement>) => void }) {
  return (
    <button type="button" className="card-media ui-action card-media-button" aria-label={`打开 ${it.name}`} onClick={() => onOpen(it)}>
      <div className="card">
        <div style={{ position: 'relative' }}>
          {/* ★ 空封面（搜索未命中 + 源图坏）→ 占位块（同上，不留灰影） */}
          {pic
             ? <img src={pic} alt={it.name} onError={(event) => onErr(it, event)} loading="lazy" decoding="async" />
            : <div className="no-cover">暂无封面</div>}
          {it.remarks && <span className="badge">{it.remarks}</span>}
          <span
            style={{
              position: 'absolute', left: 6, top: 6, background: 'rgba(0,0,0,.62)', color: 'var(--accent)',
              fontSize: 10, padding: '1px 7px', borderRadius: 999, maxWidth: '62%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            title={it.sourceName}
          >
            {it.sourceName}
          </span>
        </div>
        <div className="meta">
          <div className="name" title={it.name}>
            {/* ★ 2026-09-30：文件夹条目（盘搜的网盘分组）标个 📁，一眼看出「点进去是列表，不是详情」 */}
            {it.tag === 'folder' && <span title="文件夹：点开列出里面的资源">📁 </span>}
            {it.name}
          </div>
        </div>
      </div>
    </button>
  );
});
