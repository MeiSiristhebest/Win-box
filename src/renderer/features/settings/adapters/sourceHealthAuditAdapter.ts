import { client } from '../../../api/client';
import type { SourceHealthAuditPort } from '../application/sourceHealthAudit';

export const sourceHealthAuditAdapter: SourceHealthAuditPort = {
  run: () => client.audit(),
  deleteSource: (sourceKey) => client.cfgDeleteSource(sourceKey),
  renameProfile: async (profileId, name) => { await client.cfgUpdateProfileName({ id: profileId, name }); },
  saveProfile: (name) => client.cfgSaveAsProfile(name),
};
