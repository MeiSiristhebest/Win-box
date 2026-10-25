import { client } from '../../../api/client';
import { SOURCES_CHANGED_EVENT } from '../../../lib/configEvents';
import type { ConfigurationSnapshotPort } from '../application/configurationPagePorts';

export const configurationSnapshotAdapter: ConfigurationSnapshotPort = {
  load: () => client.cfgGet(),
  announceSourcesChanged: () => window.dispatchEvent(new Event(SOURCES_CHANGED_EVENT)),
};
