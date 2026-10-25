import { saveUiMemory, uiMem } from '../../../lib/uiMemory';
import { isSearchWindow, openSearchWindow } from '../../search/adapters/searchWindowNavigationAdapter';
import type { HomeSearchNavigationPort, HomeSearchUrlParameters } from '../application/homePorts';

/** Adapts renderer routing, search-window IPC, and UI-memory storage to the feature port. */
export function createHomeSearchNavigationAdapter(
  replaceSearchParameters: (parameters: HomeSearchUrlParameters) => void,
): HomeSearchNavigationPort {
  return {
    isSearchWindow,
    openSearchWindow,
    replaceSearchParameters,
    readRememberedSearch: () => uiMem.home.search ?? null,
    readHomeScrollTop: () => uiMem.home.scrollTop,
    persistUiMemory: saveUiMemory,
  };
}
