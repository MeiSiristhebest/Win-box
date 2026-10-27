import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/shared/types';
import { IPC } from '../src/shared/ipc-channels';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const fixtures = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => fixtures.handlers.set(channel, handler) },
}));

import { registerLocalImportIpc, type LocalImportIpcPorts } from '../src/main/ipc/localImportIpc';

const logger = { i: vi.fn(), w: vi.fn(), e: vi.fn(), d: vi.fn() } as unknown as Logger;
const owner = {} as BrowserWindow;
const event = { sender: {} } as IpcMainInvokeEvent;
const invoke = async (channel: string, ...args: unknown[]) => fixtures.handlers.get(channel)!(event, ...args);

function setup(overrides: Partial<LocalImportIpcPorts> = {}) {
  const application = {
    importPythonFiles: vi.fn((paths: readonly string[]) => ({ ok: true, keys: paths, imported: paths.length })),
    importPackage: vi.fn(async (root: string, name?: string) => ({ ok: true, root, name })),
    importLiveFile: vi.fn((path: string, name?: string) => ({ ok: true, path, name })),
  };
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/picked/input'] })) };
  const effectiveApplication = overrides.application ?? application;
  const effectiveDialog = overrides.dialog ?? dialog;
  registerLocalImportIpc({
    application: effectiveApplication,
    dialog: effectiveDialog,
    windowForEvent: () => owner,
  } as unknown as LocalImportIpcPorts, logger);
  return {
    application: effectiveApplication as typeof application,
    dialog: effectiveDialog as typeof dialog,
  };
}

describe('local import IPC adapter', () => {
  beforeEach(() => {
    fixtures.handlers.clear();
    vi.clearAllMocks();
  });

  it('delegates selected Python files and keeps the dialog result at the edge', async () => {
    const { application, dialog } = setup();

    await expect(invoke(IPC.CFG_IMPORT_PY_LOCAL)).resolves.toEqual({
      ok: true,
      data: { ok: true, keys: ['C:/picked/input'], imported: 1 },
    });
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(owner, expect.objectContaining({ properties: ['openFile', 'multiSelections'] }));
    expect(application.importPythonFiles).toHaveBeenCalledWith(['C:/picked/input']);
  });

  it('does not invoke the use case when the user cancels directory selection', async () => {
    const { application, dialog } = setup({
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
    });

    await expect(invoke(IPC.CFG_IMPORT_PACKAGE)).resolves.toEqual({ ok: true, data: { ok: false } });
    expect(application.importPackage).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(owner, expect.objectContaining({ properties: ['openDirectory'] }));
  });

  it('uses the supplied package root and name without opening another dialog', async () => {
    const { application, dialog } = setup();

    await expect(invoke(IPC.CFG_IMPORT_PACKAGE, { root: 'D:/bundle', name: 'Bundle' })).resolves.toEqual({
      ok: true,
      data: { ok: true, root: 'D:/bundle', name: 'Bundle' },
    });
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(application.importPackage).toHaveBeenCalledWith('D:/bundle', 'Bundle');
  });

  it('delegates the selected live file while leaving the naming step to the application result', async () => {
    const { application } = setup({
      application: {
        importPythonFiles: vi.fn(() => ({ ok: false })),
        importPackage: vi.fn(async () => ({ ok: false })),
        importLiveFile: vi.fn(() => ({ ok: true, needsName: true, path: 'C:/picked/input', name: 'input' })),
      },
    });

    await expect(invoke(IPC.CFG_IMPORT_LIVE_LOCAL)).resolves.toEqual({
      ok: true,
      data: { ok: true, needsName: true, path: 'C:/picked/input', name: 'input' },
    });
    expect(application.importLiveFile).toHaveBeenCalledWith('C:/picked/input', undefined);
  });

  it('does not show a dialog for the second live naming stage', async () => {
    const { application, dialog } = setup();

    await invoke(IPC.CFG_IMPORT_LIVE_LOCAL, { path: 'C:/picked/input', name: 'Renamed' });

    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(application.importLiveFile).toHaveBeenCalledWith('C:/picked/input', 'Renamed');
  });
});
