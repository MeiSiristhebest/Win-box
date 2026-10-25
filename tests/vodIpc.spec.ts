import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { Logger, PlayResult, SearchAllProgressEvent } from '../src/shared/types';
import { IPC } from '../src/shared/ipc-channels';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}));

import { registerVodIpc, type VodIpcPort } from '../src/main/ipc/vodIpc';

const logger = { i: vi.fn(), w: vi.fn(), e: vi.fn(), d: vi.fn() } as unknown as Logger;
const ipcEvent = { sender: {} } as IpcMainInvokeEvent;
const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(ipcEvent, ...args);

function register() {
  const host: VodIpcPort = {
    home: vi.fn(async (_key: string, _profileId?: string) => ({ list: [] })),
    category: vi.fn(async (_key: string, _tid: string, _pg: string, _extend: Record<string, string>, _profileId?: string) => ({ list: [] })),
    detail: vi.fn(async (_key: string, _ids: string[], _profileId?: string) => ({ list: [] })),
    search: vi.fn(async (_key: string, _wd: string, _profileId?: string) => ({ list: [] })),
    searchAll: vi.fn(async (_query: string, _options?: { refresh?: boolean; profileId?: string; profileIds?: string[] }, progress?: (event: SearchAllProgressEvent) => void) => {
      progress?.({ wd: 'film', done: 1, total: 1 });
      return { results: [], checkedSources: 1 };
    }),
    play: vi.fn(async (): Promise<PlayResult> => ({ url: '', parse: 1, playUrl: '', flag: 'line', externalLink: 'magnet:?xt=urn:btih:test' })),
  };
  const send = vi.fn();
  const writeClipboard = vi.fn();
  const windowForEvent = vi.fn(() => ({ webContents: { send } }));
  registerVodIpc(host, { windowForEvent, writeClipboard }, logger);
  return { host, send, windowForEvent, writeClipboard };
}

describe('VOD IPC adapter', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('normalizes aggregate search input and sends progress to the initiating window', async () => {
    const { host, send, windowForEvent } = register();

    await invoke(IPC.VOD_SEARCH_ALL, { wd: 'film', refresh: true, profileIds: ['a', 'b'] });

    expect(windowForEvent).toHaveBeenCalledWith(ipcEvent);
    expect(host.searchAll).toHaveBeenCalledWith('film', { refresh: true, profileId: undefined, profileIds: ['a', 'b'] }, expect.any(Function));
    expect(send).toHaveBeenCalledWith(IPC.VOD_SEARCH_ALL_PROGRESS, { wd: 'film', done: 1, total: 1 });
  });

  it('keeps the legacy string search shape and copies external playback links', async () => {
    const { host, writeClipboard } = register();

    await invoke(IPC.VOD_SEARCH_ALL, 'film');
    const result = await invoke(IPC.VOD_PLAY, { key: 'source-a', flag: 'line-a', id: 'episode-a' });

    expect(host.searchAll).toHaveBeenCalledWith('film', { refresh: false, profileId: undefined, profileIds: undefined }, expect.any(Function));
    expect(writeClipboard).toHaveBeenCalledWith('magnet:?xt=urn:btih:test');
    expect(result).toMatchObject({ ok: true, data: { externalLink: 'magnet:?xt=urn:btih:test' } });
  });

  it('does not fail playback if the clipboard port throws', async () => {
    const { writeClipboard } = register();
    writeClipboard.mockImplementation(() => { throw new Error('clipboard unavailable'); });

    await expect(invoke(IPC.VOD_PLAY, { key: 'source-a', flag: 'line-a', id: 'episode-a' }))
      .resolves.toMatchObject({ ok: true, data: { externalLink: 'magnet:?xt=urn:btih:test' } });
  });
});
