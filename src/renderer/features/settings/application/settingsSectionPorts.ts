import type { BossKeySettings, DataDirInfo, SourceDebugReport, SourceMoveDirection, SourceUpdatePatch } from '../../../../shared/types';
import type { KeymapView, PluginInspectResult, PluginView, SettingsPanelView, UiCommandView } from '../../../../shared/plugin';
import type { DavEntry, DavServer } from '../../../../shared/webdav';

export interface CacheMaintenancePort {
  loadDataDirectory(): Promise<DataDirInfo>;
  clearCache(): Promise<{ freedBytes: number; cleared: string[]; failed: string[] }>;
}

export interface NetworkSettingsPort {
  loadProxy(): Promise<{ enabled: boolean; url: string }>;
  saveProxy(settings: { enabled: boolean; url: string }): Promise<{ enabled: boolean; url: string }>;
}

export interface StorageSettingsPort {
  listServers(): Promise<DavServer[]>;
  saveServer(server: DavServer): Promise<DavServer>;
  removeServer(id: string): Promise<void>;
  testServer(server: DavServer): Promise<{ path: string; entries: DavEntry[] }>;
}

export interface ShortcutSettingsPort {
  loadBossKey(): Promise<BossKeySettings>;
  saveBossKey(patch: Partial<BossKeySettings>): Promise<{ settings: BossKeySettings; registered: boolean }>;
}

export interface PluginKeymapListPort {
  listKeymaps(): Promise<KeymapView[]>;
}

export interface SourceDiagnosticsPort {
  debugSource(sourceKey: string): Promise<SourceDebugReport>;
}

export interface SourceManagementPort {
  activateSource(sourceKey: string): Promise<void>;
  deleteSource(sourceKey: string): Promise<void>;
  deleteSources(sourceKeys: string[], expectedProfileId: string): Promise<string[]>;
  setGlobalSourceBlock(sourceKeys: string[], blocked: boolean): Promise<void>;
  moveSource(sourceKey: string, direction: SourceMoveDirection): Promise<void>;
  updateSource(sourceKey: string, patch: SourceUpdatePatch): Promise<void>;
}

export interface PlayerEngineSettingsEventsPort {
  notifyChanged(): void;
}

export interface PluginSettingsCatalogPort {
  listPlugins(): Promise<PluginView[]>;
  listPanels(): Promise<SettingsPanelView[]>;
  listCommands(): Promise<UiCommandView[]>;
  inspectInstallSource(): Promise<PluginInspectResult>;
}

export interface PluginLifecyclePort {
  install(path: string): Promise<{ ok: boolean; canceled?: boolean; reason?: string; items?: PluginView[] }>;
  uninstall(pluginId: string): Promise<{ ok: boolean; reason?: string; items?: PluginView[] }>;
  setEnabled(input: { id: string; enabled: boolean }): Promise<{ ok: boolean; reason?: string; items?: PluginView[] }>;
}

export type PluginPanelSettingsSaveResult =
  | { ok: true; panels?: SettingsPanelView[]; refreshError?: string }
  | { ok: false; reason?: string };

export interface PluginPanelSettingsPort {
  save(input: { id: string; panelId: string; key: string; value: unknown }): Promise<PluginPanelSettingsSaveResult>;
}

export interface PluginCommandExecutionPort {
  execute(command: UiCommandView, confirm?: (message: string) => Promise<boolean>): Promise<{ ok: boolean; message: string }>;
}

export interface PluginSkinRegistryPort {
  reload(): Promise<void>;
}

export interface PluginSettingsEventsPort {
  notifyChanged(): void;
}

export interface PluginSettingsDependencies {
  catalog: PluginSettingsCatalogPort;
  lifecycle: PluginLifecyclePort;
  panels: PluginPanelSettingsPort;
  commands: PluginCommandExecutionPort;
  skins: PluginSkinRegistryPort;
  events: PluginSettingsEventsPort;
}
