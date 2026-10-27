import type { VodItem } from '../../../../shared/types';
import { appendUniqueItems, pageSignature } from '../../../lib/listAppend';
import type { HomeBrowseSnapshot } from './homeBrowseSearchSession';
import type { HomeCategoryResult, HomeCategoryViewState, HomeSortClassView } from './homePorts';

export interface HomeBrowseState {
  loading: boolean;
  error: string;
  classes: HomeSortClassView[];
  tid: string;
  filtersActive: Record<string, string>;
  jumpPageInput: string;
  items: VodItem[];
  pg: number;
  pageInfo: { page: number; pagecount: number; total: number };
  wfNoMore: boolean;
  fallback: boolean;
  lastPageSignature: string;
}

export const INITIAL_HOME_BROWSE_STATE: HomeBrowseState = {
  loading: false,
  error: '',
  classes: [],
  tid: '',
  filtersActive: {},
  jumpPageInput: '',
  items: [],
  pg: 1,
  pageInfo: { page: 0, pagecount: 0, total: 0 },
  wfNoMore: false,
  fallback: false,
  lastPageSignature: '',
};

export type HomeBrowseStateAction =
  | { type: 'clear'; error?: string }
  | { type: 'home-started' }
  | { type: 'home-loaded'; result: HomeCategoryResult; fallback: boolean }
  | { type: 'home-metadata-loaded'; result: HomeCategoryResult }
  | { type: 'home-failed'; error: string }
  | { type: 'loading-cleared' }
  | { type: 'snapshot-restored'; snapshot: HomeBrowseSnapshot }
  | { type: 'category-selected'; tid: string; filters: Record<string, string>; page: number }
  | { type: 'filters-changed'; filters: Record<string, string> }
  | { type: 'category-started' }
  | { type: 'category-loaded'; result: HomeCategoryResult; page: number; append: boolean }
  | { type: 'category-failed'; append: boolean; error?: string }
  | { type: 'page-selected'; page: number }
  | { type: 'jump-input-changed'; value: string }
  | { type: 'results-cleared' };

export function reduceHomeBrowseState(state: HomeBrowseState, action: HomeBrowseStateAction): HomeBrowseState {
  switch (action.type) {
    case 'clear':
      return {
        ...state,
        loading: false,
        error: action.error || '',
        classes: [],
        tid: '',
        filtersActive: {},
        items: [],
        pg: 1,
        pageInfo: { page: 0, pagecount: 0, total: 0 },
        wfNoMore: false,
        fallback: false,
        lastPageSignature: '',
      };
    case 'home-started':
      return {
        ...state,
        loading: true,
        error: '',
        classes: [],
        tid: '',
        filtersActive: {},
        items: [],
        pg: 1,
        pageInfo: { page: 0, pagecount: 0, total: 0 },
        wfNoMore: false,
        fallback: false,
        lastPageSignature: '',
      };
    case 'home-loaded':
      return {
        ...state,
        loading: false,
        error: action.result.contentNotice || '',
        classes: action.result.sortClasses,
        tid: '',
        filtersActive: {},
        items: action.result.items,
        pg: 1,
        pageInfo: { page: action.result.page, pagecount: action.result.pagecount, total: action.result.total },
        wfNoMore: false,
        fallback: action.fallback,
        lastPageSignature: '',
      };
    case 'home-metadata-loaded':
      return { ...state, classes: action.result.sortClasses, fallback: !!action.result.homeFallback };
    case 'home-failed':
      return { ...state, loading: false, error: action.error, items: [], classes: [], wfNoMore: false, fallback: false, lastPageSignature: '' };
    case 'loading-cleared':
      return { ...state, loading: false };
    case 'snapshot-restored':
      return {
        ...state,
        loading: false,
        error: '',
        classes: action.snapshot.classes,
        items: action.snapshot.items,
        pageInfo: action.snapshot.pageInfo,
        pg: action.snapshot.pg,
        tid: action.snapshot.tid,
        filtersActive: action.snapshot.filters,
        fallback: action.snapshot.fallback,
        wfNoMore: action.snapshot.wfNoMore ?? false,
        lastPageSignature: action.snapshot.lastPageSignature ?? pageSignature(action.snapshot.items),
      };
    case 'category-selected':
      return { ...state, tid: action.tid, filtersActive: action.filters, pg: action.page, wfNoMore: false, lastPageSignature: '' };
    case 'filters-changed':
      return { ...state, filtersActive: action.filters, pg: 1, wfNoMore: false, lastPageSignature: '' };
    case 'category-started':
      return { ...state, loading: true, error: '', fallback: false };
    case 'category-loaded': {
      const signature = pageSignature(action.result.items);
      if (action.append) {
        const nextItems = appendUniqueItems(state.items, action.result.items);
        const addedNoNewItems = nextItems === state.items;
        return {
          ...state,
          loading: false,
          error: '',
          items: nextItems,
          pageInfo: { page: action.result.page, pagecount: action.result.pagecount, total: action.result.total },
          pg: action.page,
          // Some sources vary order or metadata while returning the same page. Stop when the page
          // contributes no new IDs, even when its lightweight signature differs from the prior page.
          wfNoMore: state.wfNoMore || action.result.items.length === 0 || addedNoNewItems || signature === state.lastPageSignature,
          lastPageSignature: signature,
        };
      }
      return {
        ...state,
        loading: false,
        error: '',
        items: action.result.items,
        pageInfo: { page: action.result.page, pagecount: action.result.pagecount, total: action.result.total },
        pg: action.page,
        wfNoMore: action.result.items.length === 0,
        lastPageSignature: signature,
      };
    }
    case 'category-failed':
      return action.append
        ? { ...state, loading: false, error: action.error || '' }
        : { ...state, loading: false, error: action.error || '', items: [] };
    case 'page-selected':
      return { ...state, pg: action.page };
    case 'jump-input-changed':
      return { ...state, jumpPageInput: action.value };
    case 'results-cleared':
      return { ...state, items: [] };
  }
}

export function createHomeBrowseSnapshot(sourceKey: string, state: HomeBrowseState): HomeBrowseSnapshot {
  return {
    key: sourceKey,
    items: state.items,
    classes: state.classes,
    pageInfo: state.pageInfo,
    pg: state.pg,
    tid: state.tid,
    filters: state.filtersActive,
    fallback: state.fallback,
    wfNoMore: state.wfNoMore,
    lastPageSignature: state.lastPageSignature,
  };
}

export function toggleHomeBrowseFilter(filters: Record<string, string>, key: string, value: string): Record<string, string> {
  const next = { ...filters };
  if (next[key] === value) delete next[key];
  else next[key] = value;
  return next;
}

export function rememberedHomeBrowseCategory(
  read: (sourceKey: string, categoryId: string, profileId: string) => HomeCategoryViewState | undefined,
  sourceKey: string,
  categoryId: string,
  profileId: string,
): HomeCategoryViewState {
  return read(sourceKey, categoryId, profileId) ?? { filters: {}, page: 1 };
}

export function sanitizeHomeBrowsePageInput(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function resolveHomeBrowseJumpPage(
  input: string,
  currentPage: number,
  pageCount: number,
  busy: boolean,
): number | null {
  if (busy) return null;
  const requestedPage = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(requestedPage) || requestedPage < 1 || pageCount < 1) return null;
  const page = pageCount > 999 ? requestedPage : Math.min(requestedPage, pageCount);
  return page === currentPage ? null : page;
}

export function resolveHomeBrowseAdjacentPage(
  direction: 'previous' | 'next',
  currentPage: number,
  pageCount: number,
  busy: boolean,
): number | null {
  if (busy) return null;
  if (direction === 'previous') return currentPage > 1 ? currentPage - 1 : null;
  if (pageCount > 0 && pageCount <= 999 && currentPage >= pageCount) return null;
  return currentPage + 1;
}
