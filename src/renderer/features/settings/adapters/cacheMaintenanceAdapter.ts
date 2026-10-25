import { client } from '../../../api/client';
import type { CacheMaintenancePort } from '../application/settingsSectionPorts';

export const cacheMaintenanceAdapter: CacheMaintenancePort = {
  loadDataDirectory: () => client.dataDir(),
  clearCache: () => client.cacheClear(),
};
