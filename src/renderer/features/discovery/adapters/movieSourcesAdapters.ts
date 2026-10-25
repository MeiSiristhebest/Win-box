import { client } from '../../../api/client';
import type { MovieSourceFolderPort, MovieSourcesSearchPort } from '../application/movieSourcesPorts';

/** Renderer IPC adapter for aggregate movie-source search. */
export const movieSourcesSearchAdapter: MovieSourcesSearchPort = {
  async readScope() {
    const config = await client.cfgGet();
    return {
      activeProfileId: config.activeProfileId,
      profileIds: config.profiles.map(profile => profile.id),
      hasConfiguredSources: config.sources.length > 0,
    };
  },
  onProgress: client.onSearchAllProgress,
  searchAll: client.searchAll,
};

/** Renderer IPC adapter for expanding a cloud-drive search result. */
export const movieSourceFolderAdapter: MovieSourceFolderPort = {
  category: request => client.category(request),
};
