import { client } from '../../../api/client';
import type { SavedProfilesManagementPort } from '../application/savedProfilesManagementPort';

export const savedProfilesManagementAdapter: SavedProfilesManagementPort = {
  saveCurrentProfile: async name => { await client.cfgSaveAsProfile(name); },
  renameProfile: input => client.cfgUpdateProfileName(input),
  deleteProfile: id => client.cfgDeleteProfile(id),
};
