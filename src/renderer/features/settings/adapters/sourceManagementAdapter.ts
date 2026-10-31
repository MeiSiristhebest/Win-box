import { client } from '../../../api/client';
import { SOURCE_CHANGED_EVENT, SOURCES_CHANGED_EVENT } from '../../../lib/configEvents';
import type { SourceManagementPort } from '../application/settingsSectionPorts';

export const sourceManagementAdapter: SourceManagementPort = {
  activateSource: (sourceKey) => client.cfgSetActiveSource(sourceKey),
  deleteSource: (sourceKey) => client.cfgDeleteSource(sourceKey),
  deleteSources: (sourceKeys, expectedProfileId) => client.cfgDeleteSources(sourceKeys, expectedProfileId),
  setGlobalSourceBlock: (sourceKeys, blocked) => client.cfgSetGlobalSourceBlock(sourceKeys, blocked),
  moveSource: (sourceKey, direction) => client.cfgMoveSource(sourceKey, direction),
  updateSource: async (sourceKey, patch) => { await client.cfgUpdateSource(sourceKey, patch); },
  announceSourceChanged(sourceKey) {
    window.dispatchEvent(new CustomEvent(SOURCE_CHANGED_EVENT, { detail: sourceKey }));
  },
  announceSourcesChanged() {
    window.dispatchEvent(new Event(SOURCES_CHANGED_EVENT));
  },
};
