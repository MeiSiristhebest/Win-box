import type { SearchFilterOption, SearchMatchMode } from '../../../engine/vod/searchRelevance';
import type { AggVodItem, SearchAllReport, SourceBean, VodItem } from '../../../shared/types';
import type { HomeSortClassView } from './application/homePorts';
import type { HomeCascadeLevel } from './application/homeBrowseModel';

export type HomeSearchFolder = { key: string; tid: string; name: string; profileId: string; sourceName?: string } | null;
export type HomeSearchScope = 'current' | 'all' | 'all-profiles';

export type HomeSearchResultViewModel = {
  items: AggVodItem[];
  profiles: SearchFilterOption[];
  sources: SearchFilterOption[];
  hiddenCount: number;
};

export type HomeBrowseResultsModel = {
  classes: HomeSortClassView[];
  classLevels: HomeCascadeLevel[];
  filtersOpen: boolean;
  fallback: boolean;
  items: VodItem[];
  loading: boolean;
  error: string;
  hasSources: boolean;
  listStyle: boolean;
  presetCategories: string[];
  waterfall: boolean;
  tid: string;
  pg: number;
  pageInfo: { page: number; pagecount: number; total: number };
  noMore: boolean;
  waterfallStatus: string;
  waterfallSentinelRef: { current: HTMLDivElement | null };
  jumpPage: string;
  picOf: (item: VodItem) => string;
  onImageError: (item: VodItem, failedSource: string) => void;
  onOpen: (item: VodItem) => void;
  onCascadePick: (level: string, value: string) => void;
  onToggleFilters: () => void;
  onPresetCategory: (category: string) => void;
  onImportSources: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onJumpPage: () => void;
  onJumpPageChange: (value: string) => void;
};

export type HomeSearchResultsModel = {
  report: SearchAllReport;
  view: HomeSearchResultViewModel;
  folder: HomeSearchFolder;
  loading: boolean;
  scope: HomeSearchScope;
  defaultProfileId: string;
  progress: { done: number; total: number; pending: number } | null;
  query: string;
  sourceFilter: string;
  profileFilter: string;
  matchMode: SearchMatchMode;
  visibleLimit: number;
  picOf: (item: AggVodItem) => string;
  onImageError: (item: AggVodItem, failedSource: string) => void;
  onOpenItem: (item: AggVodItem) => void;
  onRetry: () => void;
  onProfileFilter: (profileId: string) => void;
  onSourceFilter: (sourceId: string) => void;
  onMatchMode: (mode: SearchMatchMode) => void;
  onShowMore: () => void;
};

type DriveBindingModel = {
  required: boolean;
  boundNames: string[];
  openDialog: () => void;
  dialogOpen: boolean;
  closeDialog: () => void;
  onSaved: () => void;
};

export interface HomePageViewModel {
  route: { pathname: string; searchWindow: boolean };
  heading: {
    aggregate: boolean;
    browseSubtitle: string;
    title: string;
    subtitle: string;
  };
  search: {
    active: boolean;
    showToolbar: boolean;
    loading: boolean;
    error: string;
    folder: HomeSearchFolder;
    topbarStatus: string;
    emptyStatus: string;
    onReturnFromFolder: () => void;
    onReturnToBrowse: () => void;
    results: HomeSearchResultsModel | null;
  };
  source: {
    error: string;
    currentSite?: SourceBean;
    homePageUrl: string;
    webSourceError: string;
    openingWebSource: boolean;
    openWebHome: () => Promise<void>;
    driveBinding: DriveBindingModel;
  };
  browse: HomeBrowseResultsModel;
  profileScope: {
    visible: boolean;
    checked: boolean;
    disabled: boolean;
    count: number;
    onChange: (checked: boolean) => void;
  };
  backToTop: { visible: boolean; onClick: () => void };
}
