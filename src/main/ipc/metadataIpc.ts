import { IPC } from '../../shared/ipc-channels';
import type { ExploreQuery } from '../../shared/discover';
import type { ExplorePage, ExploreVocabulary } from '../../shared/discover';
import type { DiscoverBoardPage } from '../../shared/discoverBoards';
import type { MetaSettings, MetaSettingsView, MetaSuggestion } from '../../shared/meta';
import type {
  DiscoverGenre,
  DiscoverGenrePage,
  DiscoverSection,
  Logger,
  MetaExtra,
  MetaHit,
  MetaImages,
  MovieHotList,
} from '../../shared/types';
import { registerHandler } from '../util/ipcGuard';

/** Consumer-owned metadata capability required by the IPC adapter. */
export interface MetadataIpcPort {
  search(name: string, year?: string, provider?: 'tmdb' | 'douban'): Promise<MetaHit | null>;
  extras(name: string, year?: string): Promise<MetaExtra | null>;
  discover(refresh?: boolean): Promise<DiscoverSection[]>;
  boardPage(id: string, page: number, refresh?: boolean): Promise<DiscoverBoardPage>;
  movieHot(): Promise<MovieHotList>;
  discoverImages(name: string, mediaType: 'movie' | 'tv', year?: string, kind?: 'backdrop' | 'poster', doubanId?: string): Promise<MetaImages>;
  genres(): Promise<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }>;
  genrePage(mediaType: string, genreId: number, page: number): Promise<DiscoverGenrePage>;
  discoverQuery(query: ExploreQuery): Promise<ExplorePage>;
  exploreVocabulary(): Promise<ExploreVocabulary>;
  getSettings(): MetaSettingsView;
  setSettings(patch: Partial<MetaSettings>): MetaSettingsView;
  suggest(query: string): Promise<MetaSuggestion[]>;
  images(mediaType: 'movie' | 'tv', tmdbId: number): Promise<MetaImages>;
}

/** Register the metadata, discovery, and catalog-settings RPC surface as one feature. */
export function registerMetadataIpc(metadata: MetadataIpcPort, logger: Logger): void {
  registerHandler(IPC.META_SEARCH, (_e: unknown, name: string, year?: string, provider?: string) =>
    metadata.search(String(name || ''), year ? String(year) : undefined,
      provider === 'tmdb' || provider === 'douban' ? provider : undefined), logger);
  registerHandler(IPC.META_EXTRA, (_e: unknown, name: string, year?: string) =>
    metadata.extras(String(name || ''), year ? String(year) : undefined), logger);
  registerHandler(IPC.META_DISCOVER, (_e: unknown, refresh?: boolean) => metadata.discover(!!refresh), logger);
  registerHandler(IPC.META_BOARD_PAGE, (_e: unknown, id: string, page: number, refresh?: boolean) =>
    metadata.boardPage(String(id || ''), Number(page), !!refresh), logger);
  registerHandler(IPC.META_MOVIE_HOT, () => metadata.movieHot(), logger);
  registerHandler(IPC.META_DISCOVER_IMAGES, (_e: unknown, name: string, mediaType: string, year?: string, kind?: string, doubanId?: string) =>
    metadata.discoverImages(
      String(name || ''),
      mediaType === 'tv' ? 'tv' : 'movie',
      /^\d{4}$/.test(String(year)) ? String(year) : undefined,
      kind === 'poster' ? 'poster' : 'backdrop',
      /^\d{5,}$/.test(String(doubanId || '')) ? String(doubanId) : undefined,
    ), logger);
  registerHandler(IPC.META_GENRES, () => metadata.genres(), logger);
  registerHandler(IPC.META_GENRE_PAGE, (_e: unknown, mediaType: string, genreId: number, page: number) =>
    metadata.genrePage(String(mediaType || 'movie'), Number(genreId) || 0, Number(page) || 1), logger);
  registerHandler(IPC.META_DISCOVER_QUERY, (_e: unknown, query: ExploreQuery) =>
    metadata.discoverQuery(query || { mediaType: 'movie', tags: [] }), logger);
  registerHandler(IPC.META_EXPLORE_VOCAB, () => metadata.exploreVocabulary(), logger);
  registerHandler(IPC.META_GET_SETTINGS, () => metadata.getSettings(), logger);
  registerHandler(IPC.META_SET_SETTINGS, (_e: unknown, patch: unknown) =>
    metadata.setSettings((patch || {}) as Partial<MetaSettings>), logger);
  registerHandler(IPC.META_SUGGEST, (_e: unknown, query: string) => metadata.suggest(String(query || '')), logger);
  registerHandler(IPC.META_IMAGES, (_e: unknown, mediaType: string, tmdbId: number) =>
    metadata.images(String(mediaType || 'movie') === 'tv' ? 'tv' : 'movie', Number(tmdbId) || 0), logger);
}
