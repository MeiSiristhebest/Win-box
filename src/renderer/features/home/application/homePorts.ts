import type { FilterGroup, SearchAllProgressEvent, SearchAllReport, SourceBean, UserConfig, VodItem } from '../../../../shared/types';
import type { HomeSearchMem } from './HomeSearchMemory';

export type HomeCategoryResult = {
  sortClasses: { id: string; name: string; flag?: string; filters?: FilterGroup[] }[];
  items: VodItem[];
  page: number;
  pagecount: number;
  total: number;
  homeFallback?: boolean;
  contentNotice?: string;
};

export type HomeCategoryRequest = {
  key: string;
  tid: string;
  pg: string;
  extend?: Record<string, string>;
  profileId?: string;
};

export type HomeSortClassView = {
  id: string;
  name: string;
  flag?: string;
  filters?: FilterGroup[];
};

/** Minimal mutable reference contract shared by renderer adapters and workflows. */
export interface HomeMutableCell<T> {
  current: T;
}

/** Generation guard used to discard stale asynchronous search results. */
export interface HomeGenerationGuard {
  next(): number;
  isCurrent(generation: number): boolean;
}

/** Browser animation-frame boundary used by route-driven search workflows. */
export interface HomeSearchFrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/** IPC boundary required by the browse controller; adapters live at the page composition root. */
export interface HomeBrowsePort {
  home(key: string, profileId?: string): Promise<HomeCategoryResult>;
  category(request: HomeCategoryRequest): Promise<HomeCategoryResult>;
}

/** Semantic browse-session operations exposed to source restoration workflows. */
export interface HomeBrowseSessionPort {
  activeSourceKey(): string;
  selectSource(sourceKey: string): void;
  invalidateRequests(): void;
  clear(message?: string): void;
  loadHome(sourceKey: string): Promise<void>;
  restoreCategory(categoryId: string, page: number, filters: Record<string, string>): Promise<void>;
}

export type HomeCategoryViewState = { filters: Record<string, string>; page: number };

/** Remembers category-specific filter and page selections for the current renderer session. */
export interface HomeCategoryStateMemoryPort {
  read(sourceKey: string, categoryId: string, profileId: string): HomeCategoryViewState | undefined;
  save(sourceKey: string, categoryId: string, profileId: string, state: HomeCategoryViewState): void;
}

/** IPC boundary required by search orchestration and search-folder expansion. */
export interface HomeSearchPort {
  onSearchAllProgress(listener: (event: SearchAllProgressEvent) => void): () => void;
  searchAll(term: string, options?: { refresh?: boolean; profileId?: string; profileIds?: string[] }, signal?: AbortSignal): Promise<SearchAllReport>;
  search(request: { key: string; wd: string; profileId?: string }, signal?: AbortSignal): Promise<VodItem[]>;
  category(request: HomeCategoryRequest): Promise<HomeCategoryResult>;
}

export type HomeSearchUrlParameters = Record<string, string>;

/** Navigation and persistence capabilities required by home-search workflows. */
export interface HomeSearchNavigationPort {
  isSearchWindow(): boolean;
  openSearchWindow(term: string, profileId?: string, allProfiles?: boolean): Promise<void>;
  replaceSearchParameters(parameters: HomeSearchUrlParameters): void;
  readRememberedSearch(): HomeSearchMem | null;
  readHomeScrollTop(): number;
  persistUiMemory(): void;
}

/** Account lookup boundary for the home-page drive reminder. */
export interface HomeDrivePort {
  getCredentials(): Promise<Record<string, string>>;
  getLearnedSourceKeys(): Promise<string[]>;
}

/** Profile and source data needed to restore the browse context after navigation. */
export interface HomeSourceSelectionPort {
  loadConfiguration(): Promise<UserConfig>;
  loadProfileSources(profileId: string): Promise<SourceBean[]>;
}

export type HomeSourceSessionEvent =
  | { type: 'profile-changed'; preferredSourceKey: string }
  | { type: 'sources-changed' }
  | { type: 'source-changed'; sourceKey: string | null }
  | { type: 'focus' };

/** Window/profile/source notifications needed to refresh an active home session. */
export interface HomeSourceSessionEventsPort {
  subscribe(listener: (event: HomeSourceSessionEvent) => void): () => void;
}

export interface HomeWebSourceRequest {
  url: string;
  title?: string;
  site?: Record<string, string | undefined>;
}

/** Opens a package-provided web source in its dedicated window. */
export interface HomeWebSourcePort {
  open(request: HomeWebSourceRequest): Promise<{ ok: boolean; error?: string }>;
}
