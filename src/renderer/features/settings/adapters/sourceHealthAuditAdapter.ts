import { client } from '../../../api/client';
import { SOURCES_CHANGED_EVENT } from '../../../lib/configEvents';
import type { SourceHealthAuditPort } from '../application/sourceHealthAudit';

export const sourceHealthAuditAdapter: SourceHealthAuditPort = {
  run: (profileId) => client.audit(profileId),
  deleteSources: (sourceKeys, expectedProfileId, expectedSourceSignature) =>
    client.cfgDeleteSources([...sourceKeys], expectedProfileId, expectedSourceSignature),
  announceSourcesChanged() {
    window.dispatchEvent(new Event(SOURCES_CHANGED_EVENT));
  },
};
