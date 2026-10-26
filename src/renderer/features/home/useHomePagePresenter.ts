import { useMemo, useReducer, useRef, useState } from 'react';
import type { SourceBean } from '../../../shared/types';
import { projectSearchResults } from '../search/application/searchResultProjection';
import { usePageActive } from '../../lib/keepAlive';
import type { HomeCascadeLevel } from './application/homeBrowseModel';
import { useHomeBrowseController } from './useHomeBrowseController';
import { buildHomeCascadeLevels, buildHomeSearchStatusModel } from './homePageModel';
import { useHomeSearchController } from './useHomeSearchController';
import { useHomeDriveBinding } from './useHomeDriveBinding';
import { useHomeSourceSession } from './useHomeSourceSession';
import { useHomePageMemorySession } from './useHomePageMemorySession';
import { useHomeWebSource } from './useHomeWebSource';
import { initialHomeSearchViewState, reduceHomeSearchViewState, visibleHomeSearchItems } from './application/homeSearchViewState';
import type { HomePageViewModel } from './homePageViewModel';
import type { HomePageMemoryPort } from './application/homePageMemoryPort';
import type { HomeWaterfallObserverPort } from './application/homeWaterfallObserverPort';
import type { HomeBrowsePort, HomeCategoryStateMemoryPort, HomeDrivePort, HomeSearchPort, HomeSearchNavigationPort, HomeSourceSelectionPort, HomeSourceSessionEventsPort, HomeWebSourcePort } from './application/homePorts';
import type { HomeSearchWorkflowPorts } from './application/HomeSearchWorkflow';
import { useHomeItemNavigationPresenter } from './useHomeItemNavigationPresenter';
import { useHomePageCovers } from './useHomePageCovers';

export type HomePagePresenterPorts = {
  browse: HomeBrowsePort;
  drive: HomeDrivePort;
  search: HomeSearchPort;
  searchNavigation: HomeSearchNavigationPort;
  searchRuntime: Omit<HomeSearchWorkflowPorts, 'api' | 'memory'>;
  sourceSelection: HomeSourceSelectionPort;
  sourceSessionEvents: HomeSourceSessionEventsPort;
  webSource: HomeWebSourcePort;
  categoryState: HomeCategoryStateMemoryPort;
  memory: HomePageMemoryPort;
  waterfallObserver: HomeWaterfallObserverPort;
};

export type HomePagePresenterOptions = {
  onOpenDetail: (key: string, id: string, pic?: string, name?: string, profileId?: string) => void;
  route: { pathname: string; searchParams: URLSearchParams; navigate: (path: string) => void };
  filterPanel: { isOpen: boolean; toggle: () => void };
  waterfallMode: boolean;
  cardStyle: boolean;
  ports: HomePagePresenterPorts;
};
export function useHomePagePresenter({ onOpenDetail, route, filterPanel, waterfallMode, cardStyle, ports }: HomePagePresenterOptions): HomePageViewModel {
  const pageActive = usePageActive();
  /**
   * ★ 2026-09-24（用户定稿）：点播页**不放源内搜索与换源入口** ——
   *   三套皮肤（网飝 / 哔哔 / 大果）的顶栏/工具栏都已自带「全源搜索 + 换源」，此处再放一遍是重复。
   */
  const [sites, setSites] = useState<SourceBean[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const profileIdRef = useRef('');
  const [activeProfileId, setActiveProfileId] = useState('');
  const [key, setKey] = useState('');
  const [homeSearchState, dispatchHomeSearch] = useReducer(reduceHomeSearchViewState, initialHomeSearchViewState);
  const {
    term: wd,
    searchAllProfiles,
    aggregateMode: aggMode,
    report: agg,
    scope: aggScope,
    progress: aggProgress,
    visibleLimit: aggCap,
    sourceFilter: aggSrc,
    profileFilter: aggProfileFilter,
    matchMode: aggMatchMode,
    folder,
  } = homeSearchState;
  /** ★ 外部入口：/search?agg=<关键词>（详情页演员/推荐、发现页卡片点击跳来）→ 自动执行一次全源搜索 */
  const { pathname, searchParams, navigate } = route;
  const homeSearchNavigation = ports.searchNavigation;
  const searchWindow = homeSearchNavigation.isSearchWindow();
  const requestedProfileId = (searchParams.get('profileId') || '').trim();
  /** ★ 2026-09-28：用于判断当前是否在 /search 路由（URL 同步搜索词只在该路由做，避免 /home 被改成搜索路由而重挂载） */
  const [browseLoading, setBrowseLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const loading = aggMode ? searchLoading : browseLoading;
  const [browseError, setBrowseError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [profileReady, setProfileReady] = useState(false);
  const keyRef = useRef('');
  /** ★ 2026-09-26：`/search?agg=` 外部入口的本轮关键词（非空即需要跑一次全源搜索） */
  const aggParam = (searchParams.get('agg') || '').trim();
  const requestedAllProfiles = searchParams.get('profiles') !== 'current';
  const contentRef = useRef<HTMLDivElement>(null);
  /** 挂载恢复：数据就绪后回滚一次滚动位置（loadCategory 异步，须等 items 渲染） */
  const memRestoreRef = useRef(false);
  /**
   * ★ 2026-09-27（用户报「从搜索结果返回很慢、一直加载中」）：
   *   进搜索前的**浏览态快照**（当前源的首页/分类列表 + 分类骨架 + 页码/筛选/定位）。
   *   退出搜索（返回浏览）时**直接恢复它**，不再 `loadHome` —— 后者会重走
   *   `homeContent → homeVideoContent → 分类兜底` 整条链（含 .so 的 jar 单次预算 5 分钟），
   *   而这份列表用户进搜索前明明已经看过了，没有任何理由再取一次。
   */
  const browse = useHomeBrowseController({
    data: ports.browse,
    key,
    setKey,
    keyRef,
    profileIdRef,
    contentRef,
    browseLoading,
    aggMode,
    waterfall: waterfallMode,
    waterfallObserver: ports.waterfallObserver,
    categoryState: ports.categoryState,
    setBrowseLoading,
    setBrowseError,
    onMemoryRestoreStart: () => { memRestoreRef.current = true; },
    onBrowseStart: () => search.browseStarted(),
  });
  const {
    classes,
    tid,
    filtersActive,
    items,
    pg,
    pageInfo,
    fallback,
    waterfall,
    wfSentinelRef,
    loadHome,
    clearResults,
    restoreSnapshot,
    sessionPort: browseSessionPort,
    chooseCategory,
    chooseFilter,
    jumpPage,
    changeJumpPage,
    jumpToPage,
    previousPage,
    nextPage,
    wfStatusText,
    wfNoMore,
  } = browse;
  const browseSearchSession = browse.searchBrowsePort;
  const classLevels: HomeCascadeLevel[] = buildHomeCascadeLevels({ classes, tid, filtersActive, filtersOpen: filterPanel.isOpen });
  function onCascadePick(level: string, value: string): void {
    if (level === 'class') chooseCategory(value === tid ? '' : value);
    else if (level.startsWith('g:')) chooseFilter(level.slice(2), value);
  }
  const search = useHomeSearchController({
    api: ports.search,
    runtime: ports.searchRuntime,
    memory: ports.memory,
    route: {
      pathname, navigation: homeSearchNavigation, requestedProfileId, aggParam, requestedAllProfiles, profileReady,
    },
    search: {
      ...homeSearchState,
      profiles, sites,
    },
    browse: browseSearchSession,
    actions: {
      dispatchSearch: dispatchHomeSearch,
      setSearchLoading,
      setSearchError,
      clearBrowseLoading: () => setBrowseLoading(false),
      clearBrowseResults: clearResults,
      restoreBrowse: (snapshot) => {
        setSearchError('');
        restoreSnapshot(snapshot);
      },
      restoreHomeScrollPosition: (scrollTop) => {
        if (contentRef.current && scrollTop) contentRef.current.scrollTop = scrollTop;
      },
      loadHome,
    },
  });
  const { applySearchMem, setProfileSearchScope, doSearch, openFolder, exitFolder, exitSearch } = search;
  const resultProfileId = activeProfileId;
  const resultView = useMemo(() => projectSearchResults(agg?.items ?? [], wd, { mode: aggMatchMode, profileId: aggProfileFilter, sourceId: aggSrc, defaultProfileId: resultProfileId }), [agg, wd, aggMatchMode, aggProfileFilter, aggSrc, resultProfileId]);
  const aggView = useMemo(() => visibleHomeSearchItems(homeSearchState, resultView.items), [homeSearchState, resultView.items]);
  const coverSessions = useHomePageCovers({
    browseItems: items,
    searchItems: aggView,
    sourceKey: key,
    profileId: activeProfileId,
    visibleSearchLimit: aggCap,
    active: pageActive,
    loading,
    aggregateMode: aggMode,
  });
  const pageMemory = useHomePageMemorySession({
    contentRef,
    memory: ports.memory,
    keyRef,
    profileIdRef,
    restorePendingRef: memRestoreRef,
    items,
    loading: browseLoading,
    categoryId: tid,
    page: pg,
    filters: filtersActive,
    waterfall,
    aggregateMode: aggMode,
  });

  useHomeSourceSession({
    route: { requestedProfileId, pathname, aggParam, requestedAllProfiles, pageActive },
    actions: {
      profileIdRef,
      setProfileId: setActiveProfileId,
      setSites, setProfiles, setProfileReady, setSourceError,
      clearWorkflowLoading: () => {
        setBrowseLoading(false);
        setSearchLoading(false);
      },
      dispatchSearch: dispatchHomeSearch,
      applySearchMem, doSearch,
      cancelPendingSearch: search.cancelPendingSearch,
    },
    ports: { sourceSelection: ports.sourceSelection, events: ports.sourceSessionEvents, browse: browseSessionPort, memory: ports.memory },
  });

  /**
   * 搜索。
   * - 默认遍历全部已导入子仓的可搜索源，结果边搜边出；推荐站点的选择不改变这个范围。
   * - 用户可以显式缩小到当前子仓或当前站点。
   * - ★ 2026-09-23 三轮：同关键词 5 分钟内再搜 → 主进程直接返回本地缓存（**秒回**）；
   *   `force=true`（「重新搜索」按钮）忽略缓存强制重搜。
   */
  const isWideSearch = aggScope === 'all' || aggScope === 'all-profiles';
  /** 切换筛选 = 换一屏结果 → 分页计数复位 */
  const pickAggSrc = (k: string): void => {
    dispatchHomeSearch({ type: 'source-filter-selected', sourceId: k });
  };
  /** 当前源：站级样式（style=海报/列表）与预设分类（categories）随源切换生效 */
  const curSite = sites.find((s) => s.key === key) ?? (key ? undefined : sites[0]);
  const driveBinding = useHomeDriveBinding({
    source: curSite,
    port: ports.drive,
    afterSave: () => { if (keyRef.current) void loadHome(keyRef.current); },
  });
  const listStyle = !!curSite?.style && /list/i.test(curSite.style);
  const siteCats = curSite?.categories?.filter(Boolean) ?? [];
  const itemNavigation = useHomeItemNavigationPresenter({
    currentProfileId: activeProfileId,
    currentSources: sites,
    currentSite: curSite,
    fallbackSourceKey: key,
    sourceLookup: ports.sourceSelection,
    navigate,
    openFolder,
    onOpenDetail,
  });
  /** Keep memoized browse cards from receiving a new image-error callback on every render. */
  /**
   * ★ 2026-09-29（用户要求）本地包「网页源」：该源带 `homePage`（包内 html 首页，靠 window.fm 桥拉数据）
   *   → 点播页顶部给一条横幅 +「打开网页」入口，在独立窗口里打开（见 main/webbridge/WebHomeWindow.ts）。
   */
  const webSource = useHomeWebSource({ source: curSite, port: ports.webSource });


  const searchStatus = buildHomeSearchStatusModel({
    loading,
    hasReport: agg !== null,
    isWideSearch,
    progress: aggProgress,
    folder,
    folderItemCount: agg?.items.length ?? 0,
    resultCount: aggView.length,
    scope: aggScope,
    error: searchError,
    query: wd,
    profileReady,
  });

  return {
    route: { pathname, searchWindow },
    heading: {
      aggregate: aggMode,
      browseSubtitle: curSite ? "当前站点：" + (curSite.name || curSite.key) : "导入订阅后，在这里浏览和播放内容。",
      title: folder ? folder.name : "搜索结果",
      subtitle: folder
        ? "来自 " + (folder.sourceName || folder.key)
        : wd ? "“" + wd + "” · " + (aggScope === "all-profiles" ? "跨子仓搜索" : "全源搜索")
          : "搜索全部已导入来源",
    },
    search: {
      active: aggMode,
      showToolbar: aggMode && !searchWindow,
      loading,
      error: searchError,
      folder,
      topbarStatus: searchStatus.topbarStatus,
      emptyStatus: searchStatus.emptyStatus,
      onReturnFromFolder: exitFolder,
      onReturnToBrowse: exitSearch,
      results: agg ? {
        report: agg,
        view: resultView,
        folder,
        loading: searchLoading,
        scope: aggScope,
        defaultProfileId: resultProfileId,
        progress: aggProgress,
        query: wd,
        sourceFilter: aggSrc,
        profileFilter: aggProfileFilter,
        matchMode: aggMatchMode,
        visibleLimit: aggCap,
        picOf: coverSessions.searchPicOf,
        onImageError: coverSessions.onSearchImageError,
        onOpenItem: itemNavigation.openSearchResult,
        onRetry: () => void doSearch(true),
        onProfileFilter: (id: string) => dispatchHomeSearch({ type: "profile-filter-selected", profileId: id }),
        onSourceFilter: pickAggSrc,
        onMatchMode: (mode: typeof aggMatchMode) => dispatchHomeSearch({ type: "match-mode-selected", mode }),
        onShowMore: () => dispatchHomeSearch({ type: "more-results-requested" }),
      } : null,
    },
    source: {
      error: sourceError,
      currentSite: curSite,
      homePageUrl: webSource.homePageUrl,
      webSourceError: webSource.error,
      openingWebSource: webSource.opening,
      openWebHome: webSource.open,
      driveBinding,
    },
    browse: {
      classes,
      classLevels,
      filtersOpen: filterPanel.isOpen,
      fallback,
      items,
      loading: browseLoading,
      waterfall,
      tid,
      pg,
      pageInfo,
      noMore: wfNoMore,
      waterfallStatus: wfStatusText(),
      waterfallSentinelRef: wfSentinelRef,
      jumpPage,
      picOf: coverSessions.picOf,
      error: browseError,
      hasSources: sites.length > 0,
      listStyle,
      cardStyle,
      presetCategories: siteCats,
      onImageError: coverSessions.onImageError,
      onOpen: itemNavigation.openBrowseItem,
      onCascadePick,
      onToggleFilters: filterPanel.toggle,
      onPresetCategory: (category: string) => {
        const match = classes.find(item => item.name === category || String(item.id) === category);
        chooseCategory(match ? String(match.id) : "");
      },
      onImportSources: () => navigate("/config?section=sources"),
      onPreviousPage: previousPage,
      onNextPage: nextPage,
      onJumpPage: jumpToPage,
      onJumpPageChange: changeJumpPage,
    },
    profileScope: {
      visible: pathname === "/search" && aggMode && !folder && profiles.length > 1,
      checked: searchAllProfiles,
      disabled: !profileReady,
      count: profiles.length,
      onChange: setProfileSearchScope,
    },
    backToTop: pageMemory.backToTop,
  };
}
