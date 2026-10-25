import type { SearchAllReport, SourceBean } from '../../../../shared/types';
import type { AggregateSearchSessionClock } from './aggregateSearchSession';
import type { HomeSearchMem } from './HomeSearchMemory';
import type { HomeBrowseSnapshot, HomeSearchBrowsePort } from './homeBrowseSearchSession';
import type {
  HomeSearchFrameScheduler,
  HomeSearchNavigationPort,
  HomeSearchPort,
} from './homePorts';
import type { HomeSearchViewAction, HomeSearchViewState } from './homeSearchViewState';
import { AggregateSearchRetrySchedule } from './aggregateSearchRetry';
import { openHomeSearchFolder, resolveHomeSearchFolderExit, type HomeSearchFolderBack } from './homeSearchFolder';
import { executeHomeSearch, type HomeSearchExecutionScope } from './homeSearchExecution';

export type HomeSearchRoute = {
  pathname: string;
  navigation: HomeSearchNavigationPort;
  requestedProfileId: string;
  aggParam: string;
  requestedAllProfiles: boolean;
  profileReady: boolean;
};

export type HomeSearchState = Pick<
  HomeSearchViewState,
  'term' | 'searchAllSources' | 'searchAllProfiles' | 'aggregateMode' | 'report' | 'scope' | 'sourceFilter' | 'folder'
> & {
  profiles: Array<{ id: string; name: string }>;
  sites: SourceBean[];
};

export type HomeSearchPresentationPort = {
  dispatchSearch(action: HomeSearchViewAction): void;
  setSearchLoading(loading: boolean): void;
  setSearchError(message: string): void;
  clearBrowseLoading(): void;
  clearBrowseResults(): void;
  restoreBrowse(snapshot: HomeBrowseSnapshot): void;
  restoreHomeScrollPosition(scrollTop: number): void;
  loadHome(key: string): void | Promise<void>;
};

export type HomeSearchWorkflowContext = {
  route: HomeSearchRoute;
  search: HomeSearchState;
  browse: HomeSearchBrowsePort;
  presentation: HomeSearchPresentationPort;
};

export type HomeSearchWorkflowPorts = {
  api: HomeSearchPort;
  memory: HomeSearchMemoryPort;
  aggregateClock: AggregateSearchSessionClock;
  wallClock: { now(): number };
  frames: HomeSearchFrameScheduler;
};

/** Persists only the search-owned portion of the home-page session. */
export interface HomeSearchMemoryPort {
  update(patch: { search: HomeSearchMem | null; profileId: string; updatedAt: number }): void;
}

/**
 * Owns home-search decisions and asynchronous workflow without depending on React,
 * router hooks, DOM nodes, or renderer state setters.
 */
export class HomeSearchWorkflow {
  private context: HomeSearchWorkflowContext;
  private api: HomeSearchPort;
  private searchGeneration = 0;
  private readonly aggregateRetry: AggregateSearchRetrySchedule;
  private folderBack: HomeSearchFolderBack | null = null;

  constructor(
    private readonly ports: HomeSearchWorkflowPorts,
    context: HomeSearchWorkflowContext,
  ) {
    this.context = context;
    this.api = ports.api;
    this.aggregateRetry = new AggregateSearchRetrySchedule(ports.aggregateClock);
  }

  update(context: HomeSearchWorkflowContext, api = this.api): void {
    this.context = context;
    this.api = api;
  }

  dispose(): void {
    this.aggregateRetry.cancel();
    this.invalidatePendingSearch();
  }

  cancelPendingSearch = (): void => {
    this.aggregateRetry.reset();
    this.invalidatePendingSearch();
  };

  private invalidatePendingSearch(): void {
    this.searchGeneration += 1;
  }

  private beginSearchGeneration(): number {
    this.searchGeneration += 1;
    return this.searchGeneration;
  }

  private isCurrentSearchGeneration(generation: number): boolean {
    return this.searchGeneration === generation;
  }

  clearSearchMemory = (): void => {
    this.updateSearchMemory(null);
  };

  applySearchMem = (memory: HomeSearchMem): void => {
    const { browse, route, presentation } = this.context;
    if (memory.profileId) browse.setActiveProfileId(memory.profileId);
    presentation.dispatchSearch({
      type: 'search-memory-restored',
      memory,
      defaultProfileId: browse.activeProfileId(),
    });
    this.ports.frames.request(() => {
      presentation.restoreHomeScrollPosition(route.navigation.readHomeScrollTop());
    });
  };

  saveSearchMem = (
    term: string,
    report: SearchAllReport | null,
    scope: 'current' | 'all' | 'all-profiles',
    allScope = this.context.search.searchAllSources,
    profileId = this.context.browse.activeProfileId(),
    allProfiles = this.context.search.searchAllProfiles,
  ): void => {
    this.persistSearchMemory(this.context, term, report, scope, allScope, profileId, allProfiles);
  };

  setProfileSearchScope = (allProfiles: boolean): void => {
    const { search, presentation } = this.context;
    if (allProfiles && search.profiles.length < 2) return;
    presentation.dispatchSearch({ type: 'profile-scope-selected', allProfiles });
    if (search.term.trim()) void this.doSearch(true, search.term, true, allProfiles);
  };

  doSearch = async (
    force = false,
    termOverride?: string,
    forceAllScope?: boolean,
    forceAllProfileScope?: boolean,
    retrying = false,
  ): Promise<void> => {
    const context = this.context;
    const { route, search, browse, presentation } = context;
    const { pathname, navigation, requestedProfileId } = route;
    const {
      term: currentTerm,
      searchAllSources,
      searchAllProfiles,
      profiles,
      sites,
      aggregateMode,
    } = search;
    const term = (termOverride ?? currentTerm).trim();
    if (!term) return;
    if (!retrying) this.aggregateRetry.reset();

    if (pathname !== '/search' && !navigation.isSearchWindow()) {
      try {
        await navigation.openSearchWindow(
          term,
          browse.activeProfileId() || requestedProfileId || undefined,
          forceAllProfileScope ?? searchAllProfiles,
        );
      } catch (error) {
        presentation.setSearchError(String(error));
      }
      return;
    }

    const allProfileScope = forceAllProfileScope ?? searchAllProfiles;
    const allScope = allProfileScope || (forceAllScope ?? searchAllSources);
    const sourceKey = browse.activeSourceKey();
    const searchProfileId = browse.activeProfileId();
    const generation = this.beginSearchGeneration();
    browse.invalidateBrowseRequests();
    presentation.clearBrowseLoading();
    browse.preserveBrowseForSearch(aggregateMode);

    const selectedSource = sites.find((source) => source.key === sourceKey);
    const scope: HomeSearchExecutionScope = allProfileScope
      ? { kind: 'all-profiles', profileIds: profiles.map((profile) => profile.id) }
      : allScope
        ? { kind: 'all', profileId: searchProfileId }
        : { kind: 'current', profileId: searchProfileId, source: sourceKey ? { key: sourceKey, name: selectedSource?.name || sourceKey } : null };
    if (scope.kind === 'current' && !scope.source) {
      // This attempt already invalidated the previous generation above. Give
      // the new, immediately-failed attempt ownership of the visible state so
      // an older request cannot leave the page stuck in its loading state.
      presentation.dispatchSearch({ type: 'search-started', scope: scope.kind, aggregate: false });
      presentation.dispatchSearch({ type: 'search-preparation-cleared' });
      presentation.clearBrowseResults();
      presentation.setSearchError('当前未选中任何源，无法搜索');
      presentation.setSearchLoading(false);
      return;
    }

    const isAggregate = scope.kind !== 'current';
    presentation.setSearchLoading(true);
    presentation.setSearchError('');
    presentation.dispatchSearch({ type: 'search-started', scope: scope.kind, aggregate: isAggregate });
    presentation.clearBrowseResults();
    if (isAggregate) presentation.dispatchSearch({ type: 'search-progress-updated', progress: null });

    try {
      const execution = await executeHomeSearch({
        term,
        refresh: force,
        scope,
        isCurrent: () => this.isCurrentSearchGeneration(generation),
      }, {
        api: this.api,
        aggregateClock: this.ports.aggregateClock,
        wallClock: this.ports.wallClock,
        publishPartialReport: (partialReport) => presentation.dispatchSearch({ type: 'search-report-updated', report: partialReport }),
        publishProgress: (progress) => presentation.dispatchSearch({ type: 'search-progress-updated', progress }),
      });
      if (execution.kind === 'stale') return;
      if (execution.kind === 'no-profiles') {
        presentation.dispatchSearch({ type: 'search-preparation-cleared' });
        presentation.setSearchError('没有可搜索的订阅档案');
        return;
      }
      if (execution.kind === 'no-source') {
        presentation.setSearchError('当前未选中任何源，无法搜索');
        return;
      }
      if (execution.kind === 'failed') {
        presentation.setSearchError(`聚合搜索失败：${execution.message}`);
        return;
      }

      presentation.dispatchSearch({ type: 'search-report-updated', report: execution.report });
      const searchedAllProfiles = execution.scope === 'all-profiles';
      this.persistSearchMemory(
        context,
        term,
        execution.report,
        execution.scope,
        isAggregate,
        searchProfileId,
        searchedAllProfiles,
      );
      if (isAggregate && execution.report.pendingSources && execution.report.pendingSources > 0) {
        this.aggregateRetry.schedule(
          () => this.isCurrentSearchGeneration(generation)
            && browse.activeSourceKey() === sourceKey
            && browse.activeProfileId() === searchProfileId,
          () => { void this.doSearch(true, term, allScope, allProfileScope, true); },
        );
      } else {
        this.aggregateRetry.reset();
      }
    } finally {
      if (this.isCurrentSearchGeneration(generation)) {
        presentation.dispatchSearch({ type: 'search-finished', aggregate: isAggregate });
        presentation.setSearchLoading(false);
      }
    }
  };

  handleRouteChange = (): (() => void) | undefined => {
    const { route, browse, presentation } = this.context;
    const { aggParam, profileReady, requestedProfileId, requestedAllProfiles } = route;
    if (!aggParam || !profileReady) return undefined;

    const remembered = route.navigation.readRememberedSearch();
    const profileId = requestedProfileId || browse.activeProfileId();
    if (
      route.navigation.isSearchWindow()
      && remembered
      && remembered.aggMode
      && remembered.agg
      && remembered.wd === aggParam
      && remembered.profileId === profileId
      && !!remembered.searchAllProfiles === requestedAllProfiles
    ) {
      this.applySearchMem(remembered);
      return undefined;
    }

    presentation.dispatchSearch({ type: 'search-route-requested', term: aggParam, allProfiles: requestedAllProfiles });
    const frame = this.ports.frames.request(() => {
      void this.doSearch(false, aggParam, true, requestedAllProfiles);
    });
    return () => {
      this.ports.frames.cancel(frame);
      this.cancelPendingSearch();
      // A route cleanup invalidates the in-flight request, so its guarded
      // finally block cannot release the state it previously owned.
      presentation.setSearchLoading(false);
      presentation.setSearchError('');
    };
  };

  openFolder = async (sourceKey: string, id: string, name: string, profileId = this.context.browse.activeProfileId()): Promise<void> => {
    const context = this.context;
    const { route, search, browse, presentation } = context;
    const { navigation } = route;
    const { report, scope, sourceFilter, searchAllProfiles, sites, term, searchAllSources } = search;
    const key = sourceKey || browse.activeSourceKey();
    if (!key) return;
    const activeProfileId = browse.activeProfileId();
    const sourceName = report?.perSource.find((source) => source.key === key && (source.profileId ?? activeProfileId) === profileId)?.name
      || (profileId === activeProfileId ? sites.find((source) => source.key === key)?.name : undefined)
      || key;
    const generation = this.beginSearchGeneration();
    this.folderBack = { report, scope, sourceFilter, profileId, searchAllProfiles };
    presentation.setSearchLoading(true);
    presentation.setSearchError('');
    try {
      const result = await openHomeSearchFolder({
        sourceKey: key,
        categoryId: id,
        name,
        profileId,
        sourceName,
      }, {
        category: (request) => this.api.category(request),
        isCurrent: () => this.isCurrentSearchGeneration(generation),
      });
      if (result.kind === 'stale') return;
      if (result.kind === 'failed') {
        presentation.setSearchError(`展开「${name}」失败：${result.message}`);
        return;
      }
      presentation.dispatchSearch({ type: 'folder-opened', folder: result.folder, report: result.report });
      this.updateSearchMemory({
        wd: term,
        profileId,
        aggMode: true,
        aggScope: 'current',
        searchAllSources,
        searchAllProfiles,
        agg: result.report,
        folder: result.folder,
      });
      navigation.persistUiMemory();
    } finally {
      if (this.isCurrentSearchGeneration(generation)) presentation.setSearchLoading(false);
    }
  };

  exitFolder = (): void => {
    const { search, browse, presentation } = this.context;
    const transition = resolveHomeSearchFolderExit(this.folderBack, browse.activeProfileId(), search.term);
    this.folderBack = null;
    this.cancelPendingSearch();
    // Invalidate the folder request and release its presentation state here.
    // Its finally block is intentionally generation-guarded and must not clear
    // the loading state of a newer request.
    presentation.setSearchLoading(false);
    presentation.setSearchError('');
    presentation.dispatchSearch({ type: 'folder-exited', transition });
    if (transition.kind === 'restored') {
      this.updateSearchMemory(transition.memory);
      return;
    }
    this.updateSearchMemory(null);
    if (search.term.trim()) void this.doSearch(false, search.term, false);
  };

  exitSearch = (): void => {
    const { route, browse, presentation } = this.context;
    presentation.dispatchSearch({ type: 'search-exited' });
    this.cancelPendingSearch();
    // The canceled request's finally block will see a stale generation, so the
    // owner of the exit transition must clear search-only presentation state.
    presentation.setSearchLoading(false);
    presentation.setSearchError('');
    this.folderBack = null;
    this.updateSearchMemory(null);
    this.syncSearchUrl(route, browse, '');
    route.navigation.persistUiMemory();
    const destination = browse.returnDestination();
    if (destination.kind === 'restore') presentation.restoreBrowse(destination.snapshot);
    else if (destination.kind === 'reload') void presentation.loadHome(destination.sourceKey);
  };

  view = () => ({ folder: this.context.search.folder });

  private persistSearchMemory(
    context: HomeSearchWorkflowContext,
    term: string,
    report: SearchAllReport | null,
    scope: 'current' | 'all' | 'all-profiles',
    allScope: boolean,
    profileId: string,
    allProfiles: boolean,
  ): void {
    const { route } = context;
    this.updateSearchMemory({
      wd: term,
      profileId,
      aggMode: true,
      aggScope: scope,
      searchAllSources: allScope,
      searchAllProfiles: allProfiles,
      agg: report,
      folder: null,
    });
    this.syncSearchUrl(route, context.browse, term, allProfiles);
    route.navigation.persistUiMemory();
  }

  private updateSearchMemory(next: HomeSearchMem | null): void {
    const profileId = next?.profileId ?? this.context.browse.activeProfileId();
    this.ports.memory.update({
      search: next ? { ...next, profileId } : null,
      profileId,
      updatedAt: this.ports.wallClock.now(),
    });
  }

  private syncSearchUrl(
    route: HomeSearchRoute,
    browse: HomeSearchBrowsePort,
    term: string,
    allProfiles = this.context.search.searchAllProfiles,
  ): void {
    const { pathname, navigation } = route;
    if (pathname !== '/search') return;
    navigation.replaceSearchParameters(term ? {
      agg: term,
      profiles: allProfiles ? 'all' : 'current',
      ...(navigation.isSearchWindow() ? { sw: '1', profileId: browse.activeProfileId() } : {}),
    } : {});
  }
}
