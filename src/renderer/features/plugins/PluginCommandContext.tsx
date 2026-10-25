import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createPluginCommandRunner, type PluginCommandPort, type PluginCommandRunner } from './application/pluginCommand';

const unavailablePluginCommandPort: PluginCommandPort = {
  openExternal: () => undefined,
  navigate: () => undefined,
  setTheme: () => undefined,
  exportLive: async () => { throw new Error('插件命令当前不可用'); },
};

const PluginCommandContext = createContext<PluginCommandRunner>(createPluginCommandRunner(unavailablePluginCommandPort));

export function PluginCommandProvider({ port, children }: { port: PluginCommandPort; children: ReactNode }) {
  const runner = useMemo(() => createPluginCommandRunner(port), [port]);
  return <PluginCommandContext.Provider value={runner}>{children}</PluginCommandContext.Provider>;
}

export function usePluginCommandRunner(): PluginCommandRunner {
  return useContext(PluginCommandContext);
}
