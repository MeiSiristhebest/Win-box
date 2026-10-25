import { client } from '../../../api/client';
import type { DiscoverDetailMetadataPort } from '../application/discoverDetailMetadata';

export const discoverDetailMetadataAdapter: DiscoverDetailMetadataPort = {
  search: (title, year) => client.metaSearch(title, year),
  extra: (title, year) => client.metaExtra(title, year),
};
