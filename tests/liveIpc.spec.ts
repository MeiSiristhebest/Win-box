import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { Logger, LiveBean, LiveGroup } from '../src/shared/types';
import type { LiveTemplateView } from '../src/shared/plugin';
import type { LiveLoadResult } from '../src/main/live/LivePlaybackService';
import { IPC } from '../src/shared/ipc-channels';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}));

import { registerLiveIpc, type LiveExportRequest, type LiveIpcServicePort } from '../src/main/ipc/liveIpc';

const logger = { i: vi.fn(), w: vi.fn(), e: vi.fn(), d: vi.fn() } as unknown as Logger;
const ipcEvent = { sender: {} } as IpcMainInvokeEvent;
const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(ipcEvent, ...args);

function register(exportPath: string | null = 'C:/exports/live.m3u') {
  const loaded: LiveLoadResult = { groups: [], liveName: '测试直播' };
  const template: LiveTemplateView = {
    id: 'builtin:m3u', pluginId: 'builtin', label: 'M3U', format: 'm3u', ext: 'm3u',
  };
  const service: LiveIpcServicePort = {
    load: vi.fn(async () => loaded),
    lives: [{ name: '测试线路', type: '0', url: 'https://example.com/live.txt' } as LiveBean],
    loadEpg: vi.fn(async () => ({ byKey: {} })),
    templates: vi.fn(async () => [template]),
    renderExport: vi.fn(async () => ({ ...template, content: '#EXTM3U' })),
  };
  const chooseExportPath = vi.fn(async (_event: unknown, _request: LiveExportRequest) => exportPath);
  const writeExportFile = vi.fn();
  registerLiveIpc(service, { chooseExportPath, writeExportFile }, logger);
  return { service, chooseExportPath, writeExportFile, loaded, template };
}

describe('live IPC adapter', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('delegates live loading, EPG, metadata, and template rendering to the live service port', async () => {
    const { service, loaded, template } = register();
    const groups: LiveGroup[] = [];
    const channels = [{ tvgId: 'cctv1', tvgName: 'CCTV-1', name: 'CCTV1' }];

    await expect(invoke(IPC.LIVE_LOAD, '2')).resolves.toMatchObject({ ok: true, data: loaded });
    await invoke(IPC.LIVE_EPG, { index: '3', channels });
    await expect(invoke('live:meta')).resolves.toMatchObject({ data: service.lives });
    await expect(invoke(IPC.LIVE_TEMPLATES)).resolves.toMatchObject({ data: [template] });
    await invoke(IPC.LIVE_RENDER, { templateId: 'builtin:m3u', groups });

    expect(service.load).toHaveBeenCalledWith(2);
    expect(service.loadEpg).toHaveBeenCalledWith(3, channels);
    expect(service.renderExport).toHaveBeenCalledWith('builtin:m3u', groups);
  });

  it('renders before prompting, then writes the selected export path', async () => {
    const { service, chooseExportPath, writeExportFile } = register('C:/exports/custom.m3u');

    await expect(invoke(IPC.LIVE_EXPORT, { templateId: 'builtin:m3u', groups: [], defaultName: 'custom.m3u' }))
      .resolves.toMatchObject({ ok: true, data: { saved: true, path: 'C:/exports/custom.m3u' } });

    expect(chooseExportPath).toHaveBeenCalledWith(ipcEvent, {
      title: '导出直播线路', defaultName: 'custom.m3u', extension: 'm3u',
    });
    expect(writeExportFile).toHaveBeenCalledWith('C:/exports/custom.m3u', '#EXTM3U');
    expect(service.renderExport).toHaveBeenCalledOnce();
  });

  it('preserves cancel behavior without writing a file', async () => {
    const { chooseExportPath, writeExportFile } = register(null);

    await expect(invoke(IPC.LIVE_EXPORT, { groups: [] }))
      .resolves.toMatchObject({ ok: true, data: { saved: false, path: '' } });
    expect(chooseExportPath).toHaveBeenCalledOnce();
    expect(writeExportFile).not.toHaveBeenCalled();
  });
});
