import { client } from '../../../api/client';
import type { DetailDataPort } from '../application/detailDataPorts';
import { detailSelectionMemoryAdapter } from './detailSelectionMemoryAdapter';

/** Renderer IPC and UI-memory adapter for detail-route loading. */
export const detailDataAdapter: DetailDataPort = {
  async readActiveProfileId() {
    return (await client.cfgGet()).activeProfileId;
  },
  loadDetail: (key, id, profileId) => client.detail({ key, ids: [id], profileId }),
  ...detailSelectionMemoryAdapter,
};
