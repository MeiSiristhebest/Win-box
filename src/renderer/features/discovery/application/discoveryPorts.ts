import type { ExplorePage, ExploreQuery, ExploreVocabulary } from '../../../../shared/discover';
import type { DiscoverGenre, DiscoverGenrePage, DiscoverSection } from '../../../../shared/types';
import type { DiscoverBoardPage } from '../../../../shared/discoverBoards';

/** Capabilities needed by the recommendation/genre view. */
export interface DiscoverLandingPort {
  loadSections(refresh?: boolean): Promise<DiscoverSection[]>;
  loadGenres(): Promise<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }>;
  loadGenrePage(mediaType: 'movie' | 'tv', genreId: number, page: number): Promise<DiscoverGenrePage>;
}

/** Vocabulary and query capability for the categorized discovery use case. */
export interface DiscoverExplorePort {
  loadVocabulary(): Promise<ExploreVocabulary>;
  query(request: ExploreQuery): Promise<ExplorePage>;
}

/** A board feed only needs page reads; it does not need the broader metadata client. */
export interface DiscoverBoardPort {
  loadPage(id: string, page: number, refresh?: boolean): Promise<DiscoverBoardPage>;
}

export interface DiscoverBoardDirectoryPort {
  loadSections(): Promise<DiscoverSection[]>;
  hasTmdbCredentials(): Promise<boolean>;
}

export interface DiscoverBoardPreview {
  items: DiscoverSection['items'];
  stale?: boolean;
  total?: number | null;
}

export interface DiscoverBoardPreviewPort {
  loadPreview(boardId: string): Promise<DiscoverBoardPreview>;
}
