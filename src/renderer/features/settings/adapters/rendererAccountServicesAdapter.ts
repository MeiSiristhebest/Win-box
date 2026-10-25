import { client } from '../../../api/client';
import type { AccountServicesPort } from '../application/accountServicesPort';

export const rendererAccountServicesAdapter: AccountServicesPort = {
  getSubtitleSettings: () => client.subtitleGet(),
  setSubtitleSettings: patch => client.subtitleSet(patch),
  getSubtitleProviders: () => client.subtitleProviders(),
  getMetaSettings: () => client.metaGetSettings(),
  setMetaSettings: patch => client.metaSetSettings(patch),
};
