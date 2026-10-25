import { client } from '../../../api/client';
import type { LiveSourcesManagementPort } from '../application/liveSourcesPort';

export const liveSourcesManagementAdapter: LiveSourcesManagementPort = {
  selectLiveSource: index => client.cfgSetActiveLive(index),
  deleteLiveSource: index => client.cfgDeleteLive(index),
  renameLiveSource: input => client.cfgUpdateLive(input),
};
