import { createContext, useContext, type ReactNode } from 'react';
import type { PluginKeymapPort } from './application/pluginKeymapPort';

const unavailablePluginKeymaps: PluginKeymapPort = { loadKeymaps: async () => [] };
const PluginKeymapsContext = createContext<PluginKeymapPort>(unavailablePluginKeymaps);

export function PluginKeymapsProvider({ port, children }: { port: PluginKeymapPort; children: ReactNode }) {
  return <PluginKeymapsContext.Provider value={port}>{children}</PluginKeymapsContext.Provider>;
}

export function usePluginKeymapPort(): PluginKeymapPort {
  return useContext(PluginKeymapsContext);
}
