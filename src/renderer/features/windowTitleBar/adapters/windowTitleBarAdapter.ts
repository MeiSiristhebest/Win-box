import { client } from '../../../api/client';
import type { WindowTitleBarPort } from '../application/windowTitleBar';

export function createWindowTitleBarAdapter(): WindowTitleBarPort {
  return {
    loadAppIcon: () => client.appIcon(),
    readMaximized: () => client.winIsMaximized().then(Boolean),
    minimize: () => client.winMinimize(),
    async toggleMaximize() {
      await client.winMaximize();
      return Boolean(await client.winIsMaximized());
    },
    close: () => client.winClose(),
  };
}
