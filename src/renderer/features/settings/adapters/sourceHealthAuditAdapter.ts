import { client } from '../../../api/client';
import type { SourceHealthAuditPort } from '../application/sourceHealthAudit';

export const sourceHealthAuditAdapter: SourceHealthAuditPort = {
  run: (profileId) => client.audit(profileId),
  deleteSources: (sourceKeys, expectedProfileId, expectedSourceSignature) =>
    client.cfgDeleteSources([...sourceKeys], expectedProfileId, expectedSourceSignature),
};
