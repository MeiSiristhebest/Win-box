import { client } from '../../../api/client';
import type { LiveExportPort } from '../application/liveExport';

export const liveExportAdapter: LiveExportPort = {
  listTemplates: () => client.liveTemplates(),
  exportGroups: (input) => client.liveExport(input),
};
