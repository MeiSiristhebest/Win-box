import { IPC } from '../../shared/ipc-channels';
import type { Logger } from '../../shared/types';
import type {
  SubtitleCandidate,
  SubtitleFetchResult,
  SubtitleProviderView,
  SubtitleSearchReport,
  SubtitleSettings,
} from '../../shared/subtitle';
import { registerHandler } from '../util/ipcGuard';

/** Consumer-owned subtitle capability required by the IPC adapter. */
export interface SubtitleIpcPort {
  getSettings(): SubtitleSettings;
  updateSettings(patch: Partial<SubtitleSettings>): SubtitleSettings;
  providerView(): Promise<SubtitleProviderView[]>;
  search(resourceName: string): Promise<SubtitleSearchReport>;
  fetch(candidate: SubtitleCandidate): Promise<SubtitleFetchResult>;
}

export function registerSubtitleIpc(subtitles: SubtitleIpcPort, logger: Logger): void {
  registerHandler(IPC.SUBTITLE_GET, () => subtitles.getSettings(), logger);
  registerHandler(IPC.SUBTITLE_SET, (_e: unknown, patch: unknown) => subtitles.updateSettings((patch || {}) as Partial<SubtitleSettings>), logger);
  registerHandler(IPC.SUBTITLE_PROVIDERS, () => subtitles.providerView(), logger);
  registerHandler(IPC.SUBTITLE_SEARCH, (_e: unknown, name: string) => subtitles.search(String(name)), logger);
  registerHandler(IPC.SUBTITLE_FETCH, (_e: unknown, candidate: SubtitleCandidate) => subtitles.fetch(candidate), logger);
}
