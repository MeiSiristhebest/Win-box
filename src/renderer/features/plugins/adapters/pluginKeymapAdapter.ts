import { client } from '../../../api/client';
import type { PluginKeymapPort } from '../application/pluginKeymapPort';

export const pluginKeymapAdapter: PluginKeymapPort = {
  loadKeymaps: () => client.pluginKeymaps(),
};
