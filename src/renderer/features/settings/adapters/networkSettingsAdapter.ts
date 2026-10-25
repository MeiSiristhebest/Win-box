import { client } from '../../../api/client';
import type { NetworkSettingsPort } from '../application/settingsSectionPorts';

export const networkSettingsAdapter: NetworkSettingsPort = {
  loadProxy: () => client.proxyGet(),
  saveProxy: (settings) => client.proxySet(settings),
};
