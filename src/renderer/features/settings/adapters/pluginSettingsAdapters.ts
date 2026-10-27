import { client } from '../../../api/client';
import type {
  PluginCommandExecutionPort,
  PluginLifecyclePort,
  PluginPanelSettingsPort,
  PluginSettingsCatalogPort,
  PluginSettingsEventsPort,
  PluginSkinRegistryPort,
} from '../application/settingsSectionPorts';
import { savePluginPanelSetting } from '../application/savePluginPanelSetting';
import { loadPluginThemeRegistry } from '../../theme/adapters/pluginThemeRegistryAdapter';
import { createPluginCommandRunner } from '../../plugins/application/pluginCommand';
import { pluginCommandAdapter } from '../../plugins/adapters/pluginCommandAdapter';

const runPluginCommand = createPluginCommandRunner(pluginCommandAdapter);

export const pluginSettingsCatalogAdapter: PluginSettingsCatalogPort = {
  listPlugins: () => client.pluginList(),
  listPanels: () => client.pluginSettings(),
  listCommands: () => client.pluginCommands(),
  inspectInstallSource: () => client.pluginInspect(),
};

export const pluginLifecycleAdapter: PluginLifecyclePort = {
  install: (path) => client.pluginInstall({ path }),
  uninstall: (pluginId) => client.pluginUninstall(pluginId),
  setEnabled: (input) => client.pluginSetEnabled(input),
};

export const pluginPanelSettingsAdapter: PluginPanelSettingsPort = {
  save: (input) => savePluginPanelSetting({
    save: (value) => client.pluginSettingSet(value),
    loadPanels: () => client.pluginSettings(),
  }, input),
};

export const pluginCommandExecutionAdapter: PluginCommandExecutionPort = {
  execute: (command, confirm) => runPluginCommand(command, confirm),
};

export const pluginSkinRegistryAdapter: PluginSkinRegistryPort = {
  reload: loadPluginThemeRegistry,
};

export const pluginSettingsEventsAdapter: PluginSettingsEventsPort = {
  notifyChanged: () => window.dispatchEvent(new Event('winbox:plugins-changed')),
};
