import { client } from '../../../api/client';
import type { MediaDiagnosticsPort } from '../application/mediaDiagnostics';

/** Renderer IPC adapter for playback telemetry. */
export const mediaDiagnosticsAdapter: MediaDiagnosticsPort = {
  report: event => client.mediaReport(event),
};
