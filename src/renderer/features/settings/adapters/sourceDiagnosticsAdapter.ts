import { client } from '../../../api/client';
import type { SourceDiagnosticsPort } from '../application/settingsSectionPorts';

export const sourceDiagnosticsAdapter: SourceDiagnosticsPort = {
  debugSource: (sourceKey) => client.vodDebug(sourceKey),
};
