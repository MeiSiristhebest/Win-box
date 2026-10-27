import { client } from '../../../api/client';
import type {
  HomeBrowsePort,
  HomeDrivePort,
  HomeSearchPort,
  HomeSourceSelectionPort,
  HomeWebSourcePort,
} from '../application/homePorts';

export const homeBrowseAdapter: HomeBrowsePort = {
  home: (key, profileId, signal) => client.home(key, profileId, signal),
  category: (request, signal) => client.category(request, signal),
};

export const homeSearchAdapter: HomeSearchPort = {
  onSearchAllProgress: (listener) => client.onSearchAllProgress(listener),
  searchAll: (term, options, signal) => client.searchAll(term, options, signal),
  search: (request, signal) => client.search(request, signal),
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
