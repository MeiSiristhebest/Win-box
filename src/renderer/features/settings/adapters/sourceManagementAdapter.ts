import { client } from '../../../api/client';
import type { SourceManagementPort } from '../application/settingsSectionPorts';

export const sourceManagementAdapter: SourceManagementPort = {
  activateSource: (sourceKey) => client.cfgSetActiveSource(sourceKey),
  deleteSource: (sourceKey) => client.cfgDeleteSource(sourceKey),
  deleteSources: async (sourceKeys) => { await client.cfgDeleteSources(sourceKeys); },
  setGlobalSourceBlock: (sourceKeys, blocked) => client.cfgSetGlobalSourceBlock(sourceKeys, blocked),
  moveSource: (sourceKey, direction) => client.cfgMoveSource(sourceKey, direction),
  updateSource: async (sourceKey, patch) => { await client.cfgUpdateSource(sourceKey, patch); },
};
