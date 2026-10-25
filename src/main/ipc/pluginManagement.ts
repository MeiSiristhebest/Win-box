import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import type { Logger } from '../../shared/types';
import type {
  KeymapView,
  PluginInspectResult,
  PluginView,
  SettingsPanelView,
  ThemeSkinView,
  UiCommandView,
  UiSlotView,
} from '../../shared/plugin';
import type { PlayerSettings, SrMode } from '../../shared/player';
import { IPC } from '../../shared/ipc-channels';
import { registerHandler } from '../util/ipcGuard';
import type { PluginOpResult, PluginSettingResult } from '../plugin/PluginHost';

interface PluginManagementPort {
  list(): Promise<PluginView[]>;
  inspect(filePath: string): Promise<PluginInspectResult>;
  installFromFile(filePath: string): Promise<PluginOpResult>;
  uninstall(id: string): Promise<PluginOpResult>;
  setEnabled(id: string, enabled: boolean): Promise<PluginOpResult>;
  srState(wanted: SrMode): Promise<unknown>;
  themeSkins(): Promise<ThemeSkinView[]>;
  uiCommands(): Promise<UiCommandView[]>;
  keymaps(): Promise<KeymapView[]>;
  settingsPanels(): Promise<SettingsPanelView[]>;
  setPluginSetting(args: { id?: unknown; panelId?: unknown; key?: unknown; value?: unknown }): Promise<PluginSettingResult>;
  uiSlots(): Promise<UiSlotView[]>;
}

interface PluginSettingsPort {
  readonly settings: Pick<PlayerSettings, 'srMode'>;
}

export interface PluginManagementIpcDependencies {
  logger: Logger;
  plugins: PluginManagementPort;
  settings: PluginSettingsPort;
}

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function choosePluginFile(event: IpcMainInvokeEvent): Promise<string | null> {
  const window = windowOf(event);
  const picked = await dialog.showOpenDialog(window ?? undefined!, {
    title: '安装插件',
    properties: ['openFile'],
    filters: [{ name: 'Win-Box 插件', extensions: ['winbox'] }],
  });
  return picked.canceled ? null : picked.filePaths[0] || null;
}

/** Plugin-management IPC adapter: renderer payloads are normalized at the boundary. */
export function registerPluginManagementIpc({
  logger,
  plugins,
  settings,
}: PluginManagementIpcDependencies): void {
  registerHandler(IPC.PLUGIN_LIST, () => plugins.list(), logger);
  registerHandler(IPC.PLUGIN_INSPECT, async (event: IpcMainInvokeEvent) => {
    const filePath = await choosePluginFile(event);
    if (!filePath) return { ok: false, canceled: true };
    const result = await plugins.inspect(filePath);
    if (!result.ok) logger.w('插件干跑失败（' + filePath + '）：' + (result.reason || result.reasonCode || ''));
    return result;
  }, logger);
  registerHandler(IPC.PLUGIN_INSTALL, async (event: IpcMainInvokeEvent, args?: { path?: string }) => {
    let filePath = typeof args?.path === 'string' ? args.path : '';
    if (!filePath) {
      const picked = await choosePluginFile(event);
      if (!picked) return { ok: false, canceled: true };
      filePath = picked;
    }
    const result = await plugins.installFromFile(filePath);
    logger.i('插件安装：' + (result.ok ? '成功' : '失败') + '（' + filePath + '）' + (result.reason ? ' — ' + result.reason : ''));
    return result;
  }, logger);
  registerHandler(IPC.PLUGIN_UNINSTALL, (_event: unknown, id: string) => plugins.uninstall(String(id || '')), logger);
  registerHandler(IPC.PLUGIN_SET_ENABLED, (_event: unknown, args: { id: string; enabled: boolean }) =>
    plugins.setEnabled(String(args?.id || ''), !!args?.enabled), logger);
  registerHandler(IPC.PLUGIN_SR, () => plugins.srState(settings.settings.srMode), logger);
  registerHandler(IPC.PLUGIN_THEMES, () => plugins.themeSkins(), logger);
  registerHandler(IPC.PLUGIN_COMMANDS, () => plugins.uiCommands(), logger);
  registerHandler(IPC.PLUGIN_KEYMAPS, () => plugins.keymaps(), logger);
  registerHandler(IPC.PLUGIN_SETTINGS, () => plugins.settingsPanels(), logger);
  registerHandler(IPC.PLUGIN_SETTINGS_SET, (_event: unknown, args: unknown) =>
    plugins.setPluginSetting((args || {}) as { id?: unknown; panelId?: unknown; key?: unknown; value?: unknown }), logger);
  registerHandler(IPC.PLUGIN_SLOTS, () => plugins.uiSlots(), logger);
}
