import { client } from '../../../api/client';
import { createPluginThemeRegistryLoader } from '../application/pluginThemeRegistry';
import { themeApplication } from '../themeRuntime';

/** Electron IPC and renderer theme state are joined only at this adapter boundary. */
export const loadPluginThemeRegistry = createPluginThemeRegistryLoader({
  fetch: () => client.pluginThemes(),
  synchronize: (skins) => themeApplication.synchronizePluginThemeRegistry(skins),
});
