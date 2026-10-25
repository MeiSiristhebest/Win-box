import { client } from '../../../api/client';
import type {
  HomeBrowsePort,
  HomeDrivePort,
  HomeSearchPort,
  HomeSourceSelectionPort,
  HomeWebSourcePort,
} from '../application/homePorts';

export const homeBrowseAdapter: HomeBrowsePort = {
  home: (...args) => client.home(...args),
  category: (request) => client.category(request),
};

export const homeSearchAdapter: HomeSearchPort = {
  onSearchAllProgress: (listener) => client.onSearchAllProgress(listener),
  searchAll: (term, options) => client.searchAll(term, options),
  search: (request) => client.search(request),
  category: (request) => client.category(request),
};

export const homeDriveAdapter: HomeDrivePort = {
  getCredentials: () => client.driveGet(),
  getLearnedSourceKeys: () => client.driveBindKeys(),
};

export const homeSourceSelectionAdapter: HomeSourceSelectionPort = {
  loadConfiguration: () => client.cfgGet(),
  loadProfileSources: (profileId) => client.cfgProfileSources(profileId),
};

export const homeWebSourceAdapter: HomeWebSourcePort = {
  open: (request) => client.webHomeOpen(request),
};
