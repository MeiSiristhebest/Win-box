import { client } from '../../../api/client';
import type { CoverLookupPort } from '../application/coverLookupPort';

export const coverLookupAdapter: CoverLookupPort = {
  loadSettings: async () => {
    const settings = await client.metaGetSettings();
    return {
      key: JSON.stringify([settings.tmdbApiKey, settings.tmdbApiBase, settings.tmdbImageBase]),
      hasTmdb: settings.hasUserKey,
    };
  },
  searchPoster: async (name, year, provider) => (await client.metaSearch(name, year, provider))?.poster || '',
};
