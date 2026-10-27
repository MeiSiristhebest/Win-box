import type { HomeBrowseSnapshot } from './homeBrowseSearchSession';
import { createHomeBrowseSearchSession, type HomeSearchBrowsePort } from './homeBrowseSearchSession';
import { createHomeBrowseRequestSession, type HomeBrowseRequestSession, type HomeBrowseTimerPort } from './homeBrowseRequestSession';
import type { HomeBrowsePort, HomeBrowseSessionPort, HomeCategoryStateMemoryPort } from './homePorts';
import {
  createHomeBrowseSnapshot,
  INITIAL_HOME_BROWSE_STATE,
  reduceHomeBrowseState,
  rememberedHomeBrowseCategory,
  resolveHomeBrowseAdjacentPage,
  resolveHomeBrowseJumpPage,
  sanitizeHomeBrowsePageInput,
  toggleHomeBrowseFilter,
  type HomeBrowseState,
  type HomeBrowseStateAction,
} from './homeBrowseState';

/** Semantic source/profile context; renderer state and refs stay in the adapter. */
export interface HomeBrowseContextPort {
  activeSourceKey(): string;
  selectSource(sourceKey: string): void;
  activeProfileId(): string;
  setActiveProfileId(profileId: string): void;
}

export interface HomeBrowseWorkflowPorts {
  data: HomeBrowsePort;
  context: HomeBrowseContextPort;
  categoryState: HomeCategoryStateMemoryPort;
  browseStarted(): void;
  memoryRestoreStarted(): void;
}

export interface HomeBrowseWorkflowOptions {
  aggregateMode: boolean;
  waterfall: boolean;
}

/** Owns browse state transitions, request ordering, pagination and snapshot handoff. */
export class HomeBrowseWorkflow {
  private state = INITIAL_HOME_BROWSE_STATE;
  private ports: HomeBrowseWorkflowPorts;
  private options: HomeBrowseWorkflowOptions;
  private readonly listeners = new Set<() => void>();
  private readonly requests: HomeBrowseRequestSession;
  private readonly searchSession: ReturnType<typeof createHomeBrowseSearchSession>;
  readonly searchBrowsePort: HomeSearchBrowsePort;
  readonly sessionPort: HomeBrowseSessionPort;
  private waterfallRequestActive = false;
  private waterfallRequestGeneration = 0;

  constructor(
    ports: HomeBrowseWorkflowPorts,
    options: HomeBrowseWorkflowOptions,
    timer?: HomeBrowseTimerPort,
  ) {
    this.ports = ports;
    this.options = options;
    this.requests = createHomeBrowseRequestSession(timer);
    this.searchSession = createHomeBrowseSearchSession({
      activeProfileId: () => this.ports.context.activeProfileId(),
      setActiveProfileId: (profileId) => this.ports.context.setActiveProfileId(profileId),
      activeSourceKey: () => this.ports.context.activeSourceKey(),
      invalidateBrowseRequests: () => this.invalidateRequests(),
      currentSnapshot: () => createHomeBrowseSnapshot(this.ports.context.activeSourceKey(), this.state),
    });
    this.searchBrowsePort = this.searchSession.port;
    this.sessionPort = {
      activeSourceKey: () => this.ports.context.activeSourceKey(),
      selectSource: (sourceKey) => {
        this.invalidateRequests();
        this.ports.context.selectSource(sourceKey);
      },
      invalidateRequests: () => this.invalidateRequests(),
      clear: (message) => this.clearBrowse(message),
      loadHome: (sourceKey) => this.loadHome(sourceKey),
      restoreCategory: (categoryId, page, filters) => this.restoreCategoryFromSession(categoryId, page, filters),
    };
  }

  readonly getSnapshot = (): HomeBrowseState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  updatePorts(ports: HomeBrowseWorkflowPorts): void {
    this.ports = ports;
  }

  updateOptions(options: HomeBrowseWorkflowOptions): void {
    this.options = options;
  }

  activate(): void {
    this.requests.activate();
  }

  dispose(): void {
    this.invalidateWaterfallRequest();
    this.requests.dispose();
  }

  private publish(action: HomeBrowseStateAction): void {
    this.state = reduceHomeBrowseState(this.state, action);
    for (const listener of this.listeners) listener();
  }

  private notifyBrowseStarted(): void {
    this.searchSession.browseStarted();
    this.ports.browseStarted();
  }

  private invalidateRequests(): void {
    this.invalidateWaterfallRequest();
    this.requests.invalidateBrowseRequests();
  }

  private invalidateWaterfallRequest(): void {
    this.waterfallRequestGeneration += 1;
    this.waterfallRequestActive = false;
  }

  clearLoading = (): void => {
    this.publish({ type: 'loading-cleared' });
  };

  clearBrowse = (message = ''): void => {
    this.invalidateRequests();
    this.notifyBrowseStarted();
    this.ports.context.selectSource('');
    this.publish({ type: 'clear', error: message });
  };

  restoreSnapshot = (snapshot: HomeBrowseSnapshot): void => {
    this.invalidateRequests();
    this.ports.context.selectSource(snapshot.key);
    this.publish({ type: 'snapshot-restored', snapshot });
  };

  loadHome = async (sourceKey: string, retry = false): Promise<void> => {
    this.notifyBrowseStarted();
    this.invalidateWaterfallRequest();
    const request = this.requests.beginHomeRequest(retry);
    this.ports.context.selectSource(sourceKey);
    this.publish({ type: 'home-started' });
    try {
      const result = await this.ports.data.home(sourceKey, this.ports.context.activeProfileId(), request.signal);
      if (!this.requests.isListRequestCurrent(request)) return;
      this.publish({ type: 'home-loaded', result, fallback: !!result.homeFallback });
      this.requests.resetPreparationRetryBudget();
    } catch (error) {
      if (!this.requests.isListRequestCurrent(request)) return;
      const message = errorMessage(error);
      this.publish({ type: 'home-failed', error: message });
      if (/首次使用该源|正在后台/.test(message)) {
        this.requests.schedulePreparationRetry({
          isCurrent: () => this.ports.context.activeSourceKey() === sourceKey && this.requests.isListRequestCurrent(request),
          retry: () => { void this.loadHome(sourceKey, true); },
        });
      }
    }
  };

  loadCategory = async (
    categoryId: string,
    page: number,
    filters: Record<string, string> = {},
    append = false,
  ): Promise<void> => {
    const sourceKey = this.ports.context.activeSourceKey();
    if (!sourceKey) return;
    if (!append) this.invalidateWaterfallRequest();
    const request = this.requests.beginCategoryRequest();
    const profileId = this.ports.context.activeProfileId();
    this.publish({ type: 'category-started' });
    try {
      const result = categoryId
        ? await this.ports.data.category({
          key: sourceKey,
          tid: categoryId,
          pg: String(page),
          extend: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
          profileId,
        }, request.signal)
        : await this.ports.data.home(sourceKey, profileId, request.signal);
      if (!this.requests.isListRequestCurrent(request)) return;
      this.publish({ type: 'category-loaded', result, page, append });
    } catch (error) {
      if (!this.requests.isListRequestCurrent(request)) return;
      this.publish({ type: 'category-failed', append, error: errorMessage(error) });
    }
  };

  restoreCategoryFromSession = async (
    categoryId: string,
    page: number,
    filters: Record<string, string>,
  ): Promise<void> => {
    const sourceKey = this.ports.context.activeSourceKey();
    if (!sourceKey) return;
    const metadataRequest = this.requests.beginMetadataRequest();
    const profileId = this.ports.context.activeProfileId();
    this.ports.memoryRestoreStarted();
    this.publish({ type: 'category-selected', tid: categoryId, filters, page });
    void this.ports.data.home(sourceKey, profileId, metadataRequest.signal)
      .then((result) => {
        if (this.requests.isMetadataRequestCurrent(metadataRequest)) {
          this.publish({ type: 'home-metadata-loaded', result });
        }
      })
      .catch(() => undefined);
    await this.loadCategory(categoryId, page, filters);
  };

  clearResults = (): void => {
    this.publish({ type: 'results-cleared' });
  };

  loadMoreForWaterfall = (): void => {
    const state = this.state;
    if (
      this.options.aggregateMode
      || !this.options.waterfall
      || !state.tid
      || state.wfNoMore
      || this.waterfallRequestActive
      || state.loading
      || state.items.length === 0
    ) return;
    if (state.pageInfo.pagecount <= 1 || (state.pageInfo.pagecount <= 999 && state.pg >= state.pageInfo.pagecount)) return;
    this.waterfallRequestActive = true;
    const requestGeneration = ++this.waterfallRequestGeneration;
    void this.loadCategory(state.tid, state.pg + 1, state.filtersActive, true)
      .finally(() => {
        if (requestGeneration === this.waterfallRequestGeneration) this.waterfallRequestActive = false;
      });
  };

  chooseCategory = (categoryId: string): void => {
    const state = this.state;
    const sourceKey = this.ports.context.activeSourceKey();
    const profileId = this.ports.context.activeProfileId();
    if (state.tid) {
      this.ports.categoryState.save(sourceKey, state.tid, profileId, {
        filters: state.filtersActive,
        page: this.options.waterfall ? 1 : state.pg,
      });
    }
    if (!categoryId) {
      this.publish({ type: 'category-selected', tid: '', filters: {}, page: 1 });
      void this.loadCategory('', 1);
      return;
    }
    const restored = rememberedHomeBrowseCategory(
      this.ports.categoryState.read.bind(this.ports.categoryState),
      sourceKey,
      categoryId,
      profileId,
    );
    this.publish({ type: 'category-selected', tid: categoryId, filters: restored.filters, page: restored.page });
    void this.loadCategory(categoryId, restored.page, restored.filters);
  };

  chooseFilter = (groupKey: string, value: string): void => {
    const next = toggleHomeBrowseFilter(this.state.filtersActive, groupKey, value);
    this.publish({ type: 'filters-changed', filters: next });
    this.ports.categoryState.save(
      this.ports.context.activeSourceKey(),
      this.state.tid,
      this.ports.context.activeProfileId(),
      { filters: next, page: 1 },
    );
    void this.loadCategory(this.state.tid, 1, next);
  };

  changeJumpPage = (value: string): void => {
    this.publish({ type: 'jump-input-changed', value: sanitizeHomeBrowsePageInput(value) });
  };

  jumpToPage = (): void => {
    const state = this.state;
    const page = resolveHomeBrowseJumpPage(state.jumpPageInput, state.pg, state.pageInfo.pagecount, state.loading);
    if (page === null) return;
    this.publish({ type: 'page-selected', page });
    void this.loadCategory(state.tid, page, state.filtersActive);
  };

  previousPage = (): void => {
    const state = this.state;
    const page = resolveHomeBrowseAdjacentPage('previous', state.pg, state.pageInfo.pagecount, state.loading);
    if (page === null) return;
    this.publish({ type: 'page-selected', page });
    void this.loadCategory(state.tid, page, state.filtersActive);
  };

  nextPage = (): void => {
    const state = this.state;
    const page = resolveHomeBrowseAdjacentPage('next', state.pg, state.pageInfo.pagecount, state.loading);
    if (page === null) return;
    this.publish({ type: 'page-selected', page });
    void this.loadCategory(state.tid, page, state.filtersActive);
  };

  waterfallStatusText(): string {
    const state = this.state;
    if (state.loading) return '正在加载下一页…';
    if (state.wfNoMore) return `已加载 ${state.pg} 页 · 共 ${state.items.length} 条 · 该源已无更多新内容（可能不支持真分页）`;
    if (state.pageInfo.pagecount <= 999 && state.pg >= state.pageInfo.pagecount) return `已全部加载 · 共 ${state.items.length} 条`;
    return `已加载 ${state.pg} 页 · 共 ${state.items.length} 条 · 继续下滑自动加载`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
