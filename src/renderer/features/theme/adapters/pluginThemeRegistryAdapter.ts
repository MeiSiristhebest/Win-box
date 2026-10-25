import { client } from '../../../api/client';
import { synchronizePluginThemeRegistry } from '../../../lib/theme';
import { createPluginThemeRegistryLoader } from '../application/pluginThemeRegistry';

/** Electron IPC and renderer theme state are joined only at this adapter boundary. */
export const loadPluginThemeRegistry = createPluginThemeRegistryLoader({
  fetch: () => client.pluginThemes(),
  synchronize: (skins) => synchronizePluginThemeRegistry(skins),
});
