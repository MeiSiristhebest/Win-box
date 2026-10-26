import { client } from '../../../api/client';
import type { MetaSettingsPort } from '../application/metaSettingsPort';

export const rendererMetaSettingsAdapter: MetaSettingsPort = {
  getSettings: () => client.metaGetSettings(),
  saveSettings: (patch) => client.metaSetSettings(patch),
};
