import { client } from '../../../api/client';
import type { StorageBrowserPort } from '../application/storageBrowser';

export const storageBrowserAdapter: StorageBrowserPort = {
  listServers: () => client.davList(),
  browse: (serverId, path) => client.davBrowse({ id: serverId, path }),
  openExternal: (url) => client.davOpenExternal(url),
};
