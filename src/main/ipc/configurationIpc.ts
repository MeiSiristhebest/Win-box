import { IPC } from '../../shared/ipc-channels';
import type {
  Logger,
  SourceBean,
  SourceMoveDirection,
  SourceUpdatePatch,
  ImportReport,
  ConfigImportResult,
  ProfileSitesView,
  SubscriptionImportProgressEvent,
  SubscriptionRefreshResolution,
  UserConfig,
  UserProfile,
} from '../../shared/types';
import { registerHandler } from '../util/ipcGuard';

/** Consumer-owned contract for source configuration IPC. */
export interface SourceConfigurationIpcPort {
  getSnapshot(): UserConfig;
  addSource(source: SourceBean): SourceBean;
  updateSource(key: string, patch: SourceUpdatePatch): SourceBean;
  deleteSource(key: string): void;
  deleteSources(keys: readonly string[]): void;
  setGlobalSourceBlock(keys: readonly string[], blocked: boolean): void;
  moveSource(key: string, direction: SourceMoveDirection): void;
  selectActiveSource(key: string): void;
}

/** Profile IPC sees profile operations only. */
export interface ProfileIpcPort {
  listProfiles(): Array<{ id: string; name: string; apiUrl: string; sourceCount: number; importedAt: string }>;
  saveCurrentAsProfile(name: string): UserProfile;
  activateProfile(id: string): void;
  deleteProfile(id: string): void;
  renameProfile(id: string, name: string): void;
  getProfileSites(): ProfileSitesView;
  getProfileSources(id: string): SourceBean[];
  switchProfileSource(id: string, key: string): void;
}

/** Subscription-group decisions are separate from subscription job lifecycle. */
export interface SubscriptionGroupIpcPort {
  removeMember(groupId: string, memberId: string): void;
  resolveRefresh(groupId: string, memberId: string, resolution: SubscriptionRefreshResolution): void;
}

/** Live-channel configuration is independent from VOD-source configuration. */
export interface LiveChannelConfigurationIpcPort {
  select(index: number): void;
  delete(index: number): void;
  deleteMany(indices: readonly number[]): void;
  rename(index: number, name: string): void;
}

/** Source lists and imports are runtime capabilities, separate from config mutations. */
export interface SourceConfigurationReadPort {
  importConfig(source: { url?: string; json?: string; name?: string }): Promise<ConfigImportResult>;
  readonly sites: SourceBean[];
  readonly importReport: ImportReport | null;
  driveBindLearned(): string[];
}

/** Consumer-owned contract for subscription-import IPC. */
export interface SubscriptionImportIpcPort {
  start(url: string, name?: string): SubscriptionImportProgressEvent;
  cancel(jobId: string): SubscriptionImportProgressEvent;
  retryFailed(jobId: string): SubscriptionImportProgressEvent;
  continuePending(jobId: string): SubscriptionImportProgressEvent;
  get(jobId: string): SubscriptionImportProgressEvent | null;
  list(): SubscriptionImportProgressEvent[];
  resumeInterrupted(jobId: string): SubscriptionImportProgressEvent;
}

/** Registers source mutations and current configuration queries. */
export function registerSourceConfigurationIpc(
  config: SourceConfigurationIpcPort,
  reads: SourceConfigurationReadPort,
  logger: Logger,
): void {
  registerHandler(IPC.CONFIG_IMPORT, async (_event: unknown, args: { url?: string; json?: string; name?: string }) => {
    const result = await reads.importConfig(args || {});
    return { config: result.config, report: result.report, warnings: result.warnings, urls: result.urls };
  }, logger);
  registerHandler(IPC.CONFIG_LIST_SITES, () => reads.sites, logger);
  registerHandler(IPC.CONFIG_DIAGNOSE, () => reads.importReport, logger);

  registerHandler(IPC.CFG_GET, () => config.getSnapshot(), logger);
  registerHandler(IPC.DRIVE_BIND_KEYS, () => reads.driveBindLearned(), logger);
  registerHandler(IPC.CFG_ADD_SOURCE, (_event: unknown, bean: SourceBean) => config.addSource(bean), logger);
  registerHandler(IPC.CFG_UPDATE_SOURCE, (_event: unknown, args: { key: string; patch: SourceUpdatePatch }) =>
    config.updateSource(args.key, args.patch || {}), logger);
  registerHandler(IPC.CFG_DELETE_SOURCE, (_event: unknown, key: string) => config.deleteSource(key), logger);
  registerHandler(IPC.CFG_DELETE_SOURCES, (_event: unknown, keys: string[]) => config.deleteSources(Array.isArray(keys) ? keys : []), logger);
  registerHandler(IPC.CFG_GLOBAL_SOURCE_BLOCK, (_event: unknown, args: { keys: string[]; blocked: boolean }) => {
    if (!args || !Array.isArray(args.keys) || args.keys.length > 1000 || typeof args.blocked !== 'boolean' || args.keys.some((key) => typeof key !== 'string' || key.length > 256)) {
      throw new Error('全局屏蔽参数无效');
    }
    config.setGlobalSourceBlock(args.keys, args.blocked);
  }, logger);
  registerHandler(IPC.CFG_MOVE_SOURCE, (_event: unknown, args: { key: string; direction: SourceMoveDirection }) =>
    config.moveSource(args.key, args.direction), logger);
  registerHandler(IPC.CFG_SET_ACTIVE_SOURCE, (_event: unknown, key: string) => config.selectActiveSource(key), logger);
  registerHandler(IPC.CFG_IMPORT_URL, async (_event: unknown, args: { url: string; name?: string }) => {
    const result = await reads.importConfig({ url: args.url, name: args.name });
    return { config: result.config, report: result.report, warnings: result.warnings, urls: result.urls };
  }, logger);
}

/** Registers subscription import jobs and refresh decisions. */
export function registerSubscriptionImportIpc(
  imports: SubscriptionImportIpcPort,
  groups: SubscriptionGroupIpcPort,
  logger: Logger,
): void {
  registerHandler(IPC.CFG_IMPORT_JOB_START, (_event: unknown, args: { url: string; name?: string }) =>
    imports.start(String(args?.url || ''), String(args?.name || '')), logger);
  registerHandler(IPC.CFG_IMPORT_JOB_CANCEL, (_event: unknown, jobId: string) =>
    imports.cancel(String(jobId || '')), logger);
  registerHandler(IPC.CFG_IMPORT_JOB_RETRY, (_event: unknown, jobId: string) =>
    imports.retryFailed(String(jobId || '')), logger);
  registerHandler(IPC.CFG_IMPORT_JOB_CONTINUE, (_event: unknown, jobId: string) =>
    imports.continuePending(String(jobId || '')), logger);
  registerHandler(IPC.CFG_IMPORT_JOB_GET, (_event: unknown, jobId: string) =>
    imports.get(String(jobId || '')), logger);
  registerHandler(IPC.CFG_IMPORT_JOB_LIST, () => imports.list(), logger);
  registerHandler(IPC.CFG_IMPORT_JOB_RESUME, (_event: unknown, jobId: string) =>
    imports.resumeInterrupted(String(jobId || '')), logger);
  registerHandler(IPC.CFG_SUBSCRIPTION_GROUP_REMOVE_MEMBER, (_event: unknown, args: { groupId: string; memberId: string }) =>
    groups.removeMember(String(args?.groupId || ''), String(args?.memberId || '')), logger);
  registerHandler(IPC.CFG_SUBSCRIPTION_GROUP_RESOLVE_REFRESH, (_event: unknown, args: { groupId: string; memberId: string; resolution: SubscriptionRefreshResolution }) => {
    const resolution = args?.resolution;
    if (resolution !== 'keep-current' && resolution !== 'use-upstream') throw new Error('首次刷新处理方式无效');
    return groups.resolveRefresh(String(args?.groupId || ''), String(args?.memberId || ''), resolution);
  }, logger);
}

/** Registers profile selection and metadata routes. */
export function registerProfileIpc(profiles: ProfileIpcPort, logger: Logger): void {
  registerHandler(IPC.CFG_PROFILES, () => profiles.listProfiles(), logger);
  registerHandler(IPC.CFG_PROFILE_SAVE, (_event: unknown, name: string) => profiles.saveCurrentAsProfile(name), logger);
  registerHandler(IPC.CFG_PROFILE_ACTIVATE, (_event: unknown, id: string) => profiles.activateProfile(id), logger);
  registerHandler(IPC.CFG_PROFILE_DELETE, (_event: unknown, id: string) => profiles.deleteProfile(id), logger);
  registerHandler(IPC.CFG_PROFILE_UPDATE_NAME, (_event: unknown, args: { id: string; name: string }) => profiles.renameProfile(args.id, args.name), logger);
  registerHandler(IPC.CFG_PROFILE_SITES, () => profiles.getProfileSites(), logger);
  registerHandler(IPC.CFG_PROFILE_SOURCES, (_event: unknown, profileId: string) => profiles.getProfileSources(String(profileId || '')), logger);
  registerHandler(IPC.CFG_SWITCH_PROFILE_SOURCE, (_event: unknown, args: { profileId: string; key: string }) =>
    profiles.switchProfileSource(String(args?.profileId || ''), String(args?.key || '')), logger);
}

/** Registers live-channel selection and maintenance routes. */
export function registerLiveChannelConfigurationIpc(live: LiveChannelConfigurationIpcPort, logger: Logger): void {
  registerHandler(IPC.CFG_SET_ACTIVE_LIVE, (_event: unknown, index: number) => live.select(Number(index)), logger);
  registerHandler(IPC.CFG_DELETE_LIVE, (_event: unknown, index: number) => live.delete(Number(index)), logger);
  registerHandler(IPC.CFG_DELETE_LIVES, (_event: unknown, indices: number[]) =>
    live.deleteMany(Array.isArray(indices) ? indices.map(Number) : []), logger);
  registerHandler(IPC.CFG_UPDATE_LIVE, (_event: unknown, args: { index: number; name: string }) =>
    live.rename(Number(args?.index), String(args?.name ?? '')), logger);
}
