import { useEffect, useRef } from 'react';
import type { SourceBean } from '../../../shared/types';
import { makeStaleGuard } from '../../lib/staleGuard';
import { selectHomeSource, selectUsableHomeSource } from './application/homeSourceSelection';
import type { HomeSearchMem } from './application/HomeSearchMemory';
import type { HomeBrowseSessionPort, HomeMutableCell, HomeSourceSelectionPort, HomeSourceSessionEvent, HomeSourceSessionEventsPort } from './application/homePorts';
import type { HomePageMemoryPort } from './application/homePageMemoryPort';
import type { HomeSearchViewAction } from './application/homeSearchViewState';

type HomeSourceSessionRoute = {
  requestedProfileId: string;
  pathname: string;
  aggParam: string;
  requestedAllProfiles: boolean;
  pageActive: boolean;
};
type HomeSourceSessionActions = {
  profileIdRef: HomeMutableCell<string>;
  setProfileId(profileId: string): void;
  setSites(sites: SourceBean[]): void;
  setProfiles(profiles: Array<{ id: string; name: string }>): void;
  setProfileReady(ready: boolean): void;
  setSourceError(message: string): void;
  clearWorkflowLoading(): void;
  dispatchSearch(action: HomeSearchViewAction): void;
  applySearchMem(memory: HomeSearchMem): void;
  doSearch(force?: boolean, termOverride?: string, forceAllScope?: boolean, forceAllProfiles?: boolean): void | Promise<void>;
  cancelPendingSearch(): void;
};
type HomeSourceSessionPorts = {
  sourceSelection: HomeSourceSelectionPort;
  events: HomeSourceSessionEventsPort;
  browse: HomeBrowseSessionPort;
  memory: HomePageMemoryPort;
};
type HomeSourceSessionOptions = {
  route: HomeSourceSessionRoute;
  actions: HomeSourceSessionActions;
  ports: HomeSourceSessionPorts;
};

/** Owns initial source restoration and refreshes from profile/source/focus events. */
export function useHomeSourceSession({ route, actions, ports }: HomeSourceSessionOptions): void {
  const { requestedProfileId, pathname, aggParam, requestedAllProfiles, pageActive } = route;
  const routeRef = useRef(route);
  routeRef.current = route;
  const {
    profileIdRef, setProfileId, setSites, setProfiles, setProfileReady, setSourceError,
    clearWorkflowLoading,
    dispatchSearch, applySearchMem, doSearch, cancelPendingSearch,
  } = actions;
  const { sourceSelection: sourceSelectionPort, events: eventsPort, browse: browsePort, memory: memoryPort } = ports;
  const configReadGen = useRef(makeStaleGuard());

  // 首载：优先用持久化的 ui.activeSourceKey（存在且可用则用），否则回退第一个可用源
  useEffect(() => {
    let cancelled = false;
    const configRead = configReadGen.current.next();
    const isCurrent = () => !cancelled && configReadGen.current.isCurrent(configRead);
    setProfileReady(false);
    setSourceError('');
    sourceSelectionPort
      .loadConfiguration()
      .then(async (cfg) => {
        if (!isCurrent()) return;
        let selectedProfileId = requestedProfileId || cfg.activeProfileId;
        let s = cfg.sources;
        if (requestedProfileId && requestedProfileId !== cfg.activeProfileId) {
          s = await sourceSelectionPort.loadProfileSources(requestedProfileId);
        }
        if (!isCurrent()) return;
        setSourceError('');
        profileIdRef.current = selectedProfileId;
        setProfileId(selectedProfileId);
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
        const pickSource = (): string => selectHomeSource({
          sources: s,
          profileId: selectedProfileId,
          activeProfileId: cfg.activeProfileId,
          rememberedProfileId: memoryPort.read().profileId,
          rememberedSourceKey: memoryPort.read().key,
          configuredSourceKey: cfg.ui.activeSourceKey,
        });
        // ★ 外部入口：/search?agg=<关键词> —— 详情页「演员 / 相关推荐」与发现页卡片点击后跳来，
        //   自动跑一次全源搜索。**具体执行在下面的 aggParam effect**（这样「已在搜索页再次搜索」
        //   也能触发：同路由只变 query 不会重挂载，旧实现写在首载 effect 里 → 第二次搜索毫无反应）。
        if (aggParam) {
          // ★ 2026-09-28：**不再清掉参数** —— 让 URL 保留本次关键词（返回/前进天然正确，见 syncSearchUrl）。
          //   是否要真正发起搜索由下面的 aggParam effect 决定（内存已有同词结果时只恢复、不重搜）。
          dispatchSearch({ type: 'search-route-requested', term: aggParam, allProfiles: requestedAllProfiles });
          // 先把「搜索前的源」定下来（只置状态、不拉首页数据，搜索视图不需要），
          // 这样退出搜索（返回浏览）能准确回到原源与原列表。
          const pick = pickSource();
          if (pick) browsePort.selectSource(pick);
          return;
        }
        // ★ 搜索 → 详情 → 返回：恢复上次搜索结果界面（不重新浏览首页）
        const memSearch = memoryPort.read().search;
        if (pathname === '/search' && memSearch && memSearch.aggMode && memSearch.profileId === selectedProfileId && !!memSearch.searchAllProfiles === requestedAllProfiles) {
          applySearchMem(memSearch);
          const pick = pickSource();
          if (pick) browsePort.selectSource(pick);
          return;
        }
        if (s.length === 0) {
          browsePort.clear('尚未导入站源，请先到「配置」页导入');
          return;
        }
        const pick = pickSource();
        if (pick) {
          const mem = memoryPort.read();
          const useMem = mem.profileId === selectedProfileId && mem.key === pick && (mem.tid !== '' || mem.pg > 1);
          if (useMem && mem.tid) {
            // ★ 恢复到"刚看到封面的分类页"：分类 tab + 分类 + 页码 + 筛选 全部恢复
            browsePort.selectSource(pick);
            void browsePort.restoreCategory(mem.tid, mem.pg || 1, mem.filters || {});
          } else {
            void browsePort.loadHome(pick);
          }
        }
      })
      .catch((e) => {
        if (isCurrent()) {
          setSourceError((e as Error).message);
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
      const currentRoute = routeRef.current;
      if (currentRoute.requestedProfileId) return;
      if (!currentRoute.pageActive) {
        pendingProfileRef.current = true;
        configReadGen.current.next();
        return;
      }
      const request = configReadGen.current.next();
      const reload = force || pendingProfileRef.current;
      const preferred = preferredSourceRef.current;
      void sourceSelectionPort.loadConfiguration().then((cfg) => {
        if (!alive || !configReadGen.current.isCurrent(request)) return;
        const profileChanged = profileIdRef.current !== cfg.activeProfileId;
        profileIdRef.current = cfg.activeProfileId;
        setProfileId(cfg.activeProfileId);
        setSites(cfg.sources);
        setProfiles(cfg.profiles.map(({ id, name }) => ({ id, name })));
        setProfileReady(true);
        const desired = preferred || cfg.ui.activeSourceKey || (!profileChanged ? browsePort.activeSourceKey() : '');
        const source = selectUsableHomeSource(cfg.sources, desired);
        pendingProfileRef.current = false;
        preferredSourceRef.current = '';
        if (!source) {
          browsePort.clear('尚未导入站源，请先到「配置」页导入');
          return;
        }
        if (reload || profileChanged || source.key !== browsePort.activeSourceKey()) {
          if (currentRoute.pathname === '/search' && currentRoute.aggParam) {
            browsePort.selectSource(source.key);
            if (!currentRoute.requestedAllProfiles) void doSearch(true, currentRoute.aggParam, true, false);
            return;
          }
          void browsePort.loadHome(source.key);
        }
      }).catch((cause: unknown) => {
        if (alive && configReadGen.current.isCurrent(request)) {
          setProfileReady(true);
          setSourceError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    };
    const unsubscribe = eventsPort.subscribe((event: HomeSourceSessionEvent) => {
      if (event.type === 'sources-changed' || event.type === 'focus') {
        refresh();
        return;
      }
      if (routeRef.current.requestedProfileId) return;
      if (event.type === 'profile-changed') {
        pendingProfileRef.current = true;
        preferredSourceRef.current = event.preferredSourceKey;
      } else if (event.type === 'source-changed') {
        if (!event.sourceKey) return;
        preferredSourceRef.current = event.sourceKey;
        pendingProfileRef.current = true;
      }
      browsePort.invalidateRequests();
      const currentRoute = routeRef.current;
      if (currentRoute.pathname !== '/search' || !currentRoute.requestedAllProfiles) {
        cancelPendingSearch();
        clearWorkflowLoading();
      }
      refresh(true);
    });
    if (pageActive) {
      if (everActiveRef.current || pendingProfileRef.current) refresh();
      everActiveRef.current = true;
    }
    return () => {
      alive = false;
      configGeneration.next();
      unsubscribe();
    };
    // Route reads come from routeRef so the event subscription does not act on stale navigation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageActive, requestedProfileId]);
}
