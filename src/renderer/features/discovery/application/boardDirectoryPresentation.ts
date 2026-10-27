import { BOARD_CATEGORIES, DOMESTIC_BOARDS, pluginSectionToBoard, TMDB_BOARDS, type DiscoverBoard } from '../../../../shared/discoverBoards';
import type { DiscoverSection } from '../../../../shared/types';

export interface BoardDirectoryFilters {
  categoryId: string;
  query: string;
}

export interface BoardDirectoryProjection {
  boards: DiscoverBoard[];
  lockedBoards: DiscoverBoard[];
  previews: Record<string, { items: DiscoverSection['items']; stale?: boolean }>;
}

export type BoardDirectoryLoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface BoardDirectoryViewState {
  sections: { status: 'idle' | 'loading' | 'ready' | 'failed'; error: string };
  credentials: { status: 'idle' | 'loading' | 'ready' | 'failed'; error: string };
  loading: boolean;
  empty: boolean;
}

/** Project asynchronous resource state into view decisions without losing a failed/unknown state. */
export function projectBoardDirectoryViewState(input: {
  active: boolean;
  boardCount: number;
  sectionsStatus: BoardDirectoryLoadStatus;
  sectionsError: string;
  credentialsStatus: BoardDirectoryLoadStatus;
  credentialsError: string;
}): BoardDirectoryViewState {
  const sectionsStatus = input.sectionsStatus === 'idle' && input.active ? 'loading' : input.sectionsStatus;
  const credentialsStatus = input.credentialsStatus === 'idle' && input.active ? 'loading' : input.credentialsStatus;
  const sections = {
    status: sectionsStatus,
    error: sectionsStatus === 'failed' ? input.sectionsError : '',
  };
  const credentials = {
    status: credentialsStatus,
    error: credentialsStatus === 'failed' ? input.credentialsError : '',
  };

  return {
    sections,
    credentials,
    loading: sections.status === 'loading' || credentials.status === 'loading',
    // Don't call the directory empty while a failed request could still supply boards.
    empty: input.boardCount === 0 && sections.status === 'ready' && credentials.status === 'ready',
  };
}

export interface BoardCredentialState {
  hasCredentials: boolean | null;
  status: 'idle' | 'loading' | 'ready' | 'failed';
}

/** Project source data into the directory view without treating unknown credentials as missing credentials. */
export function projectBoardDirectory(
  sections: DiscoverSection[],
  credentials: BoardCredentialState,
  filters: BoardDirectoryFilters,
): BoardDirectoryProjection {
  // A retained value can be useful as a cache, but must not be presented as current
  // while its refresh is loading or has failed.
  const hasTmdbCredentials = credentials.status === 'ready' ? credentials.hasCredentials : null;
  const builtinIds = new Set([...DOMESTIC_BOARDS, ...TMDB_BOARDS].map((board) => board.id));
  const plugins = sections
    .filter((section) => section.browseId?.startsWith('plugin:') || !builtinIds.has(section.id))
    .map(pluginSectionToBoard);
  const keyword = filters.query.trim().toLocaleLowerCase();
  const matches = (board: DiscoverBoard): boolean =>
    (!filters.categoryId || board.category === filters.categoryId)
    && (!keyword || `${board.title} ${board.description} ${board.provider}`.toLocaleLowerCase().includes(keyword));
  const boards = [
    ...DOMESTIC_BOARDS,
    ...(hasTmdbCredentials ? TMDB_BOARDS : []),
    ...plugins,
  ].filter(matches).sort((a, b) =>
    BOARD_CATEGORIES.findIndex((option) => option.id === a.category)
      - BOARD_CATEGORIES.findIndex((option) => option.id === b.category));
  const lockedBoards = credentials.status === 'ready' && hasTmdbCredentials === false ? TMDB_BOARDS.filter(matches) : [];
  const previews = Object.fromEntries(
    sections
      .filter((section) => section.items.length > 0)
      .map((section) => [section.browseId || section.id, { items: section.items.slice(0, 3), stale: section.stale }]),
  );

  return { boards, lockedBoards, previews };
}
