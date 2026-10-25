import { join } from 'node:path';
import type { Logger } from '../../shared/types';
import type { MetaHit } from '../../shared/types';
import type { MetaSettings } from '../../shared/meta';
import { MetaStore } from './MetaStore';
import { MetaSettingsStore } from './MetaSettings';
import { DomesticDiscover } from './domesticDiscover';
import { DiscoverArtwork } from './discoverArtwork';
import { JsonStore } from '../store/JsonStore';
import type { DriveCodec } from '../store/DriveStore';
import type { MetadataLookupSourcePort, DiscoverySourcePort } from './MetadataService';
import { MetadataService } from './MetadataService';
import {
  tmdbSearchTitle,
  tmdbExtras,
  tmdbSuggest,
  tmdbImages,
  tmdbDiscover,
  tmdbBoardPage,
  tmdbGenres,
  tmdbGenrePage,
  metaCacheKey,
  metaQueryVariants,
  setTmdbRuntime,
  hasUserTmdbKey,
} from './tmdbProvider';
import { doubanSearchTitle, doubanStills, doubanSuggest, DOUBAN_CACHE_PREFIX } from './doubanProvider';
import { doubanExplorePage, doubanExploreVocabulary } from './doubanExplore';

export interface CreateMetadataServiceOptions {
  userDataDir: string;
  cacheDir: string;
  logger: Logger;
  driveCodec?: DriveCodec;
  metadataProviders?: () => Promise<readonly MetadataLookupSourcePort[] | undefined>;
  discoverySources?: () => Promise<readonly DiscoverySourcePort[] | undefined>;
}

/** Composition adapter joining metadata use cases to their concrete stores and providers. */
export function createMetadataService(options: CreateMetadataServiceOptions): MetadataService {
  const { logger } = options;
  const metaStore = new MetaStore(new JsonStore(join(options.userDataDir, 'meta.json')));
  const settingsStore = new MetaSettingsStore(join(options.userDataDir, 'meta-settings.json'), logger, options.driveCodec);
  const domesticDiscover = new DomesticDiscover(new JsonStore(join(options.cacheDir, 'discovery.json')), logger);
  const discoverArtwork = new DiscoverArtwork(
    new JsonStore(join(options.cacheDir, 'discovery-artwork.json')),
    options.cacheDir,
    logger,
  );

  return new MetadataService({
    settings: {
      read: () => settingsStore.settings,
      write: (settings) => { settingsStore.settings = settings; },
    },
    cache: {
      get: (key) => metaStore.cacheGet(key),
      set: (key, hit: MetaHit | null, verifiedAt) => metaStore.cacheSet(key, hit, verifiedAt),
    },
    tmdb: {
      configure: (settings: MetaSettings) => setTmdbRuntime({
        userKey: settings.tmdbApiKey,
        apiBase: settings.tmdbApiBase,
        imageBase: settings.tmdbImageBase,
      }),
      hasKey: hasUserTmdbKey,
      images: (mediaType, tmdbId) => tmdbImages(logger, mediaType, tmdbId),
      suggest: (query) => tmdbSuggest(logger, query),
      searchTitle: (name, year) => tmdbSearchTitle(metaStore, logger, name, year),
      extras: (name, year) => tmdbExtras(metaStore, logger, name, year),
      discover: (refresh) => tmdbDiscover(logger, refresh),
      boardPage: (id, page, refresh) => tmdbBoardPage(logger, id, page, refresh),
      genres: () => tmdbGenres(logger),
      genrePage: (mediaType, genreId, page) => tmdbGenrePage(logger, mediaType, genreId, page),
    },
    douban: {
      suggest: (query) => doubanSuggest(logger, query),
      titleVariants: metaQueryVariants,
      cacheKey: (name, year) => `${DOUBAN_CACHE_PREFIX}cover-v2:${metaCacheKey(name, year)}`,
      searchTitle: (name, year) => doubanSearchTitle(logger, name, year),
      stills: (doubanId) => doubanStills(logger, doubanId),
      explorePage: (query) => doubanExplorePage(logger, query),
      exploreVocabulary: () => doubanExploreVocabulary(logger),
    },
    domestic: {
      discover: (refresh) => domesticDiscover.discover(refresh),
      boardPage: (id, page, refresh) => domesticDiscover.boardPage(id, page, refresh),
      genres: () => domesticDiscover.genres(),
      genrePage: (mediaType, genreId, page) => domesticDiscover.genrePage(mediaType, genreId, page),
      hot: () => domesticDiscover.hot(),
    },
    artwork: {
      images: (name, mediaType, year, kind) => discoverArtwork.images(name, mediaType, year, kind),
    },
    plugins: {
      metadataProviders: async () => (await options.metadataProviders?.()) ?? [],
      discoverySources: async () => (await options.discoverySources?.()) ?? [],
    },
    logger,
    now: () => Date.now(),
  });
}
