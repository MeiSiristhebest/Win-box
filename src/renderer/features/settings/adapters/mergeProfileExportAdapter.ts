import { client } from '../../../api/client';
import type { MergeProfileExportPort } from '../application/mergeProfileExport';

export const mergeProfileExportAdapter: MergeProfileExportPort = {
  mergeProfiles: (profileIds) => client.mergeExport(profileIds),
  saveMergedFile: (content) => client.mergeSave({
    content,
    defaultName: `merged-subscription-${new Date().toISOString().slice(0, 10)}.json`,
  }),
};
