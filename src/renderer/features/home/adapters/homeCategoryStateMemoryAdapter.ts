import { getSessionSort, setSessionSort } from '../../../lib/sessionSort';
import type { HomeCategoryStateMemoryPort } from '../application/homePorts';

/** Keeps category filter/page selections in renderer-session memory. */
export const homeCategoryStateMemoryAdapter: HomeCategoryStateMemoryPort = {
  read: (sourceKey, categoryId, profileId) => {
    const saved = getSessionSort(sourceKey, categoryId, profileId);
    return saved ? { filters: { ...saved.filter }, page: saved.pg } : undefined;
  },
  save: (sourceKey, categoryId, profileId, state) => {
    setSessionSort(sourceKey, categoryId, { filter: { ...state.filters }, pg: state.page }, profileId);
  },
};
