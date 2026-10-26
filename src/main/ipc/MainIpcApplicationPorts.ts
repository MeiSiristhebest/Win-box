import type { AuditItem, ConfigImportResult, ImportReport, LiveBean, SourceDebugReport } from '../../shared/types';
import type { MergedProfilesExport } from '../configuration/ProfileConfigurationApplicationService';
import type {
  LiveChannelConfigurationIpcPort,
  ProfileIpcPort,
  SourceConfigurationIpcPort,
  SourceConfigurationReadPort,
  ConfigRuntimeSyncIpcPort,
  SubscriptionGroupIpcPort,
  SubscriptionImportIpcPort,
} from './configurationIpc';
import type { DriveIpcPort } from './driveIpc';
import type { LiveIpcServicePort } from './liveIpc';
import type { VodIpcPort } from './vodIpc';

export interface SubscriptionImportConfigurationPort {
  importConfig(source: { url?: string; json?: string; name?: string }): Promise<ConfigImportResult>;
  readonly latestReport: ImportReport | null;
}

export interface MergedProfileExportPort {
  exportMergedProfiles(ids: string[]): MergedProfilesExport;
}

export interface AddLiveChannelPort {
  add(channel: LiveBean): { index: number; replaced: boolean };
}

export interface SourceDiagnosticsIpcPort {
  debug(key: string): Promise<SourceDebugReport>;
  auditAll(): Promise<AuditItem[]>;
}

export interface SpiderRuntimeIpcPort {
  rewarmAfterCacheClear(): void;
  onPlaybackStarted(): void;
  clearSpiderInstances(): void;
}

export interface DriveFileCleanupIpcPort {
  deletePending(): Promise<void>;
}

/**
 * Application capabilities consumed by the Electron IPC adapters.
 * Keep this port map narrower than the full SpiderHost service graph.
 */
export interface MainIpcApplicationPorts {
  sourceConfiguration: SourceConfigurationIpcPort;
  sourceReads: SourceConfigurationReadPort;
  configRuntimeSync: ConfigRuntimeSyncIpcPort;
  subscriptionImports: SubscriptionImportIpcPort & SubscriptionImportConfigurationPort;
  subscriptionGroups: SubscriptionGroupIpcPort;
  profileConfiguration: ProfileIpcPort & MergedProfileExportPort;
  liveChannelConfiguration: LiveChannelConfigurationIpcPort & AddLiveChannelPort;
  sourceDiagnostics: SourceDiagnosticsIpcPort;
  driveAccounts: DriveIpcPort;
  spiderRuntime: SpiderRuntimeIpcPort;
  driveFileCleanup: DriveFileCleanupIpcPort;
  vod: VodIpcPort;
  livePlayback: LiveIpcServicePort;
}
