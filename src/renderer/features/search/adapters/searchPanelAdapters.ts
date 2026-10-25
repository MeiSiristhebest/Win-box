import { client } from '../../../api/client';
import { openSearchWindow } from './searchWindowNavigationAdapter';
import {
  clearSearchHistory,
  loadSearchHistory,
  pushSearchTerm,
  removeSearchTerm,
  saveSearchHistory,
} from '../../../lib/searchHistory';
import type { SearchPanelPorts } from '../application/searchPanel';

export function createSearchPanelAdapters(): SearchPanelPorts {
  return {
    recommendations: {
      loadHotList: () => client.metaMovieHot(),
      suggest: (term) => client.metaSuggest(term),
    },
    history: {
      load: loadSearchHistory,
      record: (term) => {
        const next = pushSearchTerm(loadSearchHistory(), term);
        saveSearchHistory(next);
        return next;
      },
      remove: (current, term) => {
        const next = removeSearchTerm(current, term);
        saveSearchHistory(next);
        return next;
      },
      clear: clearSearchHistory,
    },
    navigation: { openSearch: openSearchWindow },
  };
}
