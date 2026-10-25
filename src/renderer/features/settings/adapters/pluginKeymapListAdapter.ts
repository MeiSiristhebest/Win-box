import { client } from '../../../api/client';
import type { PluginKeymapListPort } from '../application/settingsSectionPorts';

export const pluginKeymapListAdapter: PluginKeymapListPort = {
  listKeymaps: () => client.pluginKeymaps(),
};
