import { client } from '../../../api/client';
import { getNavMode } from '../../../lib/uiPrefs';
import { resolveSearchWindowNavigation, isSearchWindowHash } from '../application/searchWindowNavigation';

let inlineNavigator: ((route: string) => void) | null = null;

export function isSearchWindow(): boolean {
  return typeof window !== 'undefined' && isSearchWindowHash(window.location.hash);
}

export function bindSearchNavigation(navigate: ((route: string) => void) | null): void {
  inlineNavigator = navigate;
}

export async function openSearchWindow(term: string, profileId?: string, allProfiles?: boolean): Promise<void> {
  const currentHash = typeof window === 'undefined' ? '' : window.location.hash;
  const decision = resolveSearchWindowNavigation({
    term,
    currentHash,
    navigationMode: getNavMode(),
    hasInlineNavigator: inlineNavigator !== null,
    profileId,
    allProfiles,
  });

  switch (decision.type) {
    case 'ignore':
      return;
    case 'set-search-window-route':
      if (typeof window !== 'undefined') window.location.hash = decision.route;
      return;
    case 'navigate-inline':
      inlineNavigator?.(decision.route);
      return;
    case 'open-search-window':
      await client.winOpenSearch(decision.term, decision.profileId, decision.allProfiles);
      return;
  }
}
