import { client } from '../../../api/client';
import type { DetailBackdropPort } from '../application/detailBackdrop';

export const detailBackdropAdapter: DetailBackdropPort = {
  async load(name, mediaType, year) {
    const result = await client.metaDiscoverImages(name, mediaType, year, 'backdrop');
    return result.backdrops;
  },
};
