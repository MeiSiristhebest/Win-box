import type { BrowserWindow, IpcMainInvokeEvent, OpenDialogOptions } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { Logger } from '../../shared/types';
import type { LocalImportApplicationPort } from '../configuration/LocalImportApplicationService';
import { registerHandler } from '../util/ipcGuard';

export interface LocalImportDialogPort {
  showOpenDialog(owner: BrowserWindow | null, options: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface LocalImportIpcPorts {
  application: LocalImportApplicationPort;
  dialog: LocalImportDialogPort;
  windowForEvent(event: IpcMainInvokeEvent): BrowserWindow | null;
}

/** Electron-facing adapter: select input files, forward the request, and return its DTO. */
export function registerLocalImportIpc(ports: LocalImportIpcPorts, logger: Logger): void {
  registerHandler(IPC.CFG_IMPORT_PY_LOCAL, async (event) => {
    const picked = await ports.dialog.showOpenDialog(ports.windowForEvent(event), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Python 蜘蛛脚本', extensions: ['py'] }],
    });
    if (picked.canceled || !picked.filePaths?.length) return { ok: false };
    return ports.application.importPythonFiles(picked.filePaths);
  }, logger);

  registerHandler(IPC.CFG_IMPORT_PACKAGE, async (event, args?: { name?: string; root?: string }) => {
    let root = String(args?.root || '');
    if (!root) {
      const picked = await ports.dialog.showOpenDialog(ports.windowForEvent(event), {
        properties: ['openDirectory'],
        title: '选择本地包目录（支持仅含 .py 文件的文件夹，自动生成订阅 JSON）',
      });
      if (picked.canceled || !picked.filePaths?.[0]) return { ok: false };
      root = picked.filePaths[0];
    }
    return ports.application.importPackage(root, args?.name);
  }, logger);

  registerHandler(IPC.CFG_IMPORT_LIVE_LOCAL, async (event, args?: { name?: string; path?: string }) => {
    let path = String(args?.path || '').trim();
    if (!path) {
      const picked = await ports.dialog.showOpenDialog(ports.windowForEvent(event), {
        properties: ['openFile'],
        filters: [{ name: '直播源（TXT / M3U）', extensions: ['txt', 'm3u', 'm3u8'] }],
      });
      if (picked.canceled || !picked.filePaths?.[0]) return { ok: false };
      path = picked.filePaths[0];
    }
    return ports.application.importLiveFile(path, args?.name);
  }, logger);
}
