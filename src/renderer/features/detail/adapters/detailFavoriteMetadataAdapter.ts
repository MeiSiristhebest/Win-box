import { client } from '../../../api/client';
import type { DetailFavoriteMetadataPort } from '../application/detailFavoriteMetadata';

export const detailFavoriteMetadataAdapter: DetailFavoriteMetadataPort = {
  async load(sourceKey, requestedProfileId) {
    const config = await client.cfgGet();
    return {
      profileId: requestedProfileId || config.activeProfileId,
      sourceName: config.sources.find((source) => source.key === sourceKey)?.name || '',
    };
  },
};
