import { client } from '../../../api/client';
import type { StorageSettingsPort } from '../application/settingsSectionPorts';

export const storageSettingsAdapter: StorageSettingsPort = {
  listServers: () => client.davList(),
  saveServer: (server) => client.davSet(server),
  removeServer: (id) => client.davRemove(id),
  testServer: (server) => client.davTest(server),
};
