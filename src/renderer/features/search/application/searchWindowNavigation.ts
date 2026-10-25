import { isDetailWinHash } from '../../../../shared/detailWin';
import { isSearchWinHash, searchWindowRoute } from '../../../../shared/searchWin';

export interface SearchWindowNavigationInput {
  term: string;
  currentHash: string;
  navigationMode: 'inline' | 'window';
  hasInlineNavigator: boolean;
  profileId?: string;
  allProfiles?: boolean;
}

export type SearchWindowNavigationDecision =
  | { type: 'ignore' }
  | { type: 'set-search-window-route'; route: string }
  | { type: 'navigate-inline'; route: string }
  | { type: 'open-search-window'; term: string; profileId?: string; allProfiles: boolean };

/** Chooses how a search should be presented without reading browser, preference, or IPC state. */
export function resolveSearchWindowNavigation(input: SearchWindowNavigationInput): SearchWindowNavigationDecision {
  const term = input.term.trim();
  if (!term) return { type: 'ignore' };

  if (isSearchWindowHash(input.currentHash)) {
    const current = new URLSearchParams(input.currentHash.split('?').slice(1).join('?'));
    return {
      type: 'set-search-window-route',
      route: searchWindowRoute(
        term,
        input.profileId ?? current.get('profileId') ?? undefined,
        input.allProfiles ?? current.get('profiles') !== 'current',
      ),
    };
  }

  if (!isDetailWindowHash(input.currentHash) && input.navigationMode === 'inline' && input.hasInlineNavigator) {
    const route = searchWindowRoute(term, input.profileId, input.allProfiles);
    const queryIndex = route.indexOf('?');
    const parameters = new URLSearchParams(route.slice(queryIndex + 1));
    parameters.delete('sw');
    return { type: 'navigate-inline', route: `${route.slice(0, queryIndex)}?${parameters.toString()}` };
  }

  return {
    type: 'open-search-window',
    term,
    profileId: input.profileId,
    allProfiles: input.allProfiles ?? true,
  };
}

/** Route identity is derived from the current hash so it cannot become stale after navigation. */
export const isSearchWindowHash = isSearchWinHash;

export function isDetailWindowHash(hash: string): boolean {
  return isDetailWinHash(hash);
}
