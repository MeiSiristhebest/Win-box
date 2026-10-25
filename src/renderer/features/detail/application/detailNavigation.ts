import { detailRoute } from '../../../../shared/detailWin';

export type DetailNavigationMode = 'inline' | 'window';

export interface DetailNavigationRequest {
  key: string;
  id: string;
  query?: string;
  currentWindowIsDetail: boolean;
  currentWindowIsSearch: boolean;
  mode: DetailNavigationMode;
}

export type DetailNavigationDecision =
  | { kind: 'open-window'; key: string; id: string; query: string }
  | { kind: 'navigate-inline'; route: string };

/** Decide where detail navigation belongs without reading browser, preferences or IPC state. */
export function decideDetailNavigation(request: DetailNavigationRequest): DetailNavigationDecision {
  if (request.currentWindowIsDetail || request.currentWindowIsSearch || request.mode === 'window') {
    return {
      kind: 'open-window',
      key: request.key,
      id: request.id,
      query: String(request.query || ''),
    };
  }
  return {
    kind: 'navigate-inline',
    route: detailRoute(request.key, request.id, request.query),
  };
}
