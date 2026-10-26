import type { AggVodItem, SearchAllReport } from '../../../../shared/types';
import type { SearchMatchMode } from '../../../../shared/searchTitleMatching';
import type { HomeSearchMem } from './HomeSearchMemory';
import type { ExitHomeSearchFolderResult, HomeSearchFolder } from './homeSearchFolder';

export type HomeSearchScope = HomeSearchMem['aggScope'];
export type HomeSearchProgress = { done: number; total: number; pending: number } | null;

export interface HomeSearchViewState {
  term: string;
  searchAllSources: boolean;
  searchAllProfiles: boolean;
  aggregateMode: boolean;
  report: SearchAllReport | null;
  scope: HomeSearchScope;
  progress: HomeSearchProgress;
  visibleLimit: number;
  sourceFilter: string;
  profileFilter: string;
  matchMode: SearchMatchMode;
  folder: HomeSearchFolder | null;
}

export const initialHomeSearchViewState: HomeSearchViewState = {
  term: '',
  searchAllSources: true,
  searchAllProfiles: true,
  aggregateMode: false,
  report: null,
  scope: 'current',
  progress: null,
  visibleLimit: 60,
  sourceFilter: '',
  profileFilter: '',
  matchMode: 'related',
  folder: null,
};

export type HomeSearchViewAction =
  | { type: 'term-changed'; term: string }
  | { type: 'search-route-requested'; term: string; allProfiles: boolean }
  | { type: 'search-memory-restored'; memory: HomeSearchMem; defaultProfileId: string }
  | { type: 'profile-scope-selected'; allProfiles: boolean }
  | { type: 'search-started'; scope: HomeSearchScope; aggregate: boolean }
  | { type: 'search-progress-updated'; progress: HomeSearchProgress }
  | { type: 'search-report-updated'; report: SearchAllReport }
  | { type: 'search-preparation-cleared' }
  | { type: 'search-finished'; aggregate: boolean }
  | { type: 'folder-opened'; folder: HomeSearchFolder; report: SearchAllReport }
  | { type: 'folder-exited'; transition: ExitHomeSearchFolderResult }
  | { type: 'search-exited' }
  | { type: 'browse-started' }
  | { type: 'source-filter-selected'; sourceId: string }
  | { type: 'profile-filter-selected'; profileId: string }
  | { type: 'match-mode-selected'; mode: SearchMatchMode }
  | { type: 'more-results-requested'; amount?: number };

/** Pure presentation-model transitions for the home search surface. */
export function reduceHomeSearchViewState(
  state: HomeSearchViewState,
  action: HomeSearchViewAction,
): HomeSearchViewState {
  switch (action.type) {
    case 'term-changed':
      return { ...state, term: action.term };
    case 'search-route-requested':
      return {
        ...state,
        term: action.term,
        searchAllSources: true,
        searchAllProfiles: action.allProfiles,
      };
    case 'search-memory-restored': {
      const memory = action.memory;
      const folder = memory.folder
        ? { ...memory.folder, profileId: memory.folder.profileId ?? memory.profileId ?? action.defaultProfileId }
        : null;
      return {
        ...state,
        term: memory.wd,
        aggregateMode: true,
        report: memory.agg as SearchAllReport | null,
        scope: memory.aggScope,
        searchAllSources: memory.searchAllSources,
        searchAllProfiles: !!memory.searchAllProfiles,
        folder,
      };
    }
    case 'profile-scope-selected':
      return {
        ...state,
        searchAllProfiles: action.allProfiles,
        searchAllSources: action.allProfiles ? true : state.searchAllSources,
      };
    case 'search-started':
      return {
        ...state,
        aggregateMode: true,
        scope: action.scope,
        searchAllSources: action.scope === 'all-profiles' ? true : state.searchAllSources,
        report: null,
        ...(action.aggregate ? { progress: null, visibleLimit: 60, sourceFilter: '' } : {}),
      };
    case 'search-progress-updated':
      return { ...state, progress: action.progress };
    case 'search-report-updated':
      return { ...state, report: action.report };
    case 'search-preparation-cleared':
      return { ...state, progress: null, sourceFilter: '' };
    case 'search-finished':
      return action.aggregate ? { ...state, progress: null } : state;
    case 'folder-opened':
      return {
        ...state,
        folder: action.folder,
        aggregateMode: true,
        scope: 'current',
        report: action.report,
        sourceFilter: '',
        visibleLimit: 60,
      };
    case 'folder-exited':
      if (action.transition.kind === 'search-again') {
        return { ...state, folder: null, report: null };
      }
      return {
        ...state,
        folder: null,
        report: action.transition.report,
        scope: action.transition.scope,
        searchAllSources: action.transition.searchAllSources,
        searchAllProfiles: action.transition.searchAllProfiles,
        sourceFilter: action.transition.sourceFilter,
        visibleLimit: 60,
      };
    case 'search-exited':
      return { ...state, term: '', aggregateMode: false, report: null, sourceFilter: '', folder: null };
    case 'browse-started':
      return { ...state, aggregateMode: false, report: null };
    case 'source-filter-selected':
      return { ...state, sourceFilter: action.sourceId, visibleLimit: 60 };
    case 'profile-filter-selected':
      return { ...state, profileFilter: action.profileId, sourceFilter: '', visibleLimit: 60 };
    case 'match-mode-selected':
      return { ...state, matchMode: action.mode, visibleLimit: 60 };
    case 'more-results-requested':
      return { ...state, visibleLimit: state.visibleLimit + (action.amount ?? 60) };
  }
}

export function visibleHomeSearchItems(state: HomeSearchViewState, filteredItems: readonly AggVodItem[]): readonly AggVodItem[] {
  return state.folder ? state.report?.items ?? [] : filteredItems;
}
