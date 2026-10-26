import { client } from '../../../api/client';
import { isDetailWinHash } from '../../../../shared/detailWin';
import { isSearchWinHash } from '../../../../shared/searchWin';
import { getNavMode } from '../../../lib/uiPrefs';
import { decideDetailNavigation } from '../application/detailNavigation';
import type { DetailPageSurface } from '../application/detailPagePresentation';

function currentWindowHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

export function detailPageSurface(): DetailPageSurface {
  return isDetailWinHash(currentWindowHash()) ? 'detail-window' : 'main-window';
}

export function isDetailWindow(): boolean {
  return detailPageSurface() === 'detail-window';
}

/** Apply the pure detail destination decision to the current renderer and main-process ports. */
export async function openDetailRoute(
  navigateInline: (route: string) => void,
  key: string,
  id: string,
  query?: string,
): Promise<void> {
  const hash = currentWindowHash();
  const decision = decideDetailNavigation({
    currentWindowIsDetail: isDetailWinHash(hash),
    currentWindowIsSearch: isSearchWinHash(hash),
    mode: getNavMode(),
    key,
    id,
    query,
  });
  if (decision.kind === 'open-window') {
    await client.winOpenDetail({ key: decision.key, id: decision.id, query: decision.query });
    return;
  }
  navigateInline(decision.route);
}
