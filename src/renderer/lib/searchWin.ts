import { client } from '../api/client';
import { isSearchWinHash, searchWindowRoute } from '../../shared/searchWin';
import { isDetailWinHash } from '../../shared/detailWin';
import { getNavMode } from './uiPrefs';

const searchWindow = isSearchWinHash(window.location.hash);
export function isSearchWindow(): boolean { return searchWindow; }

let navFn: ((to: string) => void) | null = null;
export function bindSearchNav(fn: ((to: string) => void) | null): void { navFn = fn; }

function inlineSearchRoute(term: string, profileId?: string, allProfiles?: boolean): string {
  const route = searchWindowRoute(term, profileId, allProfiles);
  const [pathname, query] = route.split('?');
  const params = new URLSearchParams(query);
  params.delete('sw');
  return pathname + '?' + params.toString();
}

export async function openSearchWindow(term: string, profileId?: string, allProfiles?: boolean): Promise<void> {
  const value = term.trim();
  if (!value) return;
  if (searchWindow) {
    const current = new URLSearchParams(window.location.hash.split('?').slice(1).join('?'));
    window.location.hash = searchWindowRoute(
      value,
      profileId ?? current.get('profileId') ?? undefined,
      allProfiles ?? (current.get('profiles') !== 'current'),
    );
    return;
  }
  if (!isDetailWinHash(window.location.hash) && getNavMode() === 'inline' && navFn) {
    navFn(inlineSearchRoute(value, profileId, allProfiles));
    return;
  }
  await client.winOpenSearch(value, profileId, allProfiles ?? true);
}
