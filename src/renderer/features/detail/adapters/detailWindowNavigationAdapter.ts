import { client } from '../../../api/client';
import { isDetailWinHash } from '../../../../shared/detailWin';
import { isSearchWinHash } from '../../../../shared/searchWin';
import { getNavMode } from '../../../lib/uiPrefs';
import { decideDetailNavigation } from '../application/detailNavigation';

const currentWindowIsDetail = isDetailWinHash(window.location.hash);

export function isDetailWindow(): boolean {
  return currentWindowIsDetail;
}

/** Apply the pure detail destination decision to the current renderer and main-process ports. */
export async function openDetailRoute(
  navigateInline: (route: string) => void,
  key: string,
  id: string,
  query?: string,
): Promise<void> {
  const decision = decideDetailNavigation({
    currentWindowIsDetail,
    currentWindowIsSearch: isSearchWinHash(window.location.hash),
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
