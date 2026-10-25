import { client } from '../../../api/client';
import type {
  DiscoverBoardDirectoryPort,
  DiscoverBoardPort,
  DiscoverBoardPreviewPort,
  DiscoverExplorePort,
  DiscoverLandingPort,
} from '../application/discoveryPorts';

export const discoverLandingAdapter: DiscoverLandingPort = {
  loadSections: refresh => client.metaDiscover(refresh),
  loadGenres: () => client.metaGenres(),
  loadGenrePage: (mediaType, genreId, page) => client.metaGenrePage(mediaType, genreId, page),
};

export const discoverExploreAdapter: DiscoverExplorePort = {
  loadVocabulary: () => client.metaExploreVocab(),
  query: request => client.metaDiscoverQuery(request),
};

export const discoverBoardAdapter: DiscoverBoardPort = {
  loadPage: (id, page, refresh) => client.metaBoardPage(id, page, refresh),
};

const previewLanes: Promise<unknown>[] = Array.from({ length: 3 }, () => Promise.resolve());
let nextPreviewLane = 0;
function enqueuePreview<T>(job: () => Promise<T>): Promise<T> {
  const lane = nextPreviewLane++ % previewLanes.length;
  const pending = previewLanes[lane].then(job);
  previewLanes[lane] = pending.catch(() => undefined);
  return pending;
}

export const discoverBoardDirectoryAdapter: DiscoverBoardDirectoryPort = {
  loadSections: () => client.metaDiscover(),
  async hasTmdbCredentials() {
    const settings = await client.metaGetSettings();
    return settings.hasUserKey;
  },
};

export const discoverBoardPreviewAdapter: DiscoverBoardPreviewPort = {
  loadPreview: boardId => enqueuePreview(async () => {
    const page = await client.metaBoardPage(boardId, 1);
    return { items: page.items.slice(0, 3), stale: page.stale, total: page.total };
  }),
};
