import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { Logger, PlayResult, SearchAllProgressEvent } from '../src/shared/types';
import { IPC } from '../src/shared/ipc-channels';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type EventHandler = (event: IpcMainEvent, ...args: unknown[]) => void;
const handlers = vi.hoisted(() => new Map<string, Handler>());
const listeners = vi.hoisted(() => new Map<string, EventHandler>());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    on: (channel: string, listener: EventHandler) => listeners.set(channel, listener),
  },
}));

import { registerVodIpc, type VodIpcPort } from '../src/main/ipc/vodIpc';

const logger = { i: vi.fn(), w: vi.fn(), e: vi.fn(), d: vi.fn() } as unknown as Logger;
const sender = { id: 1, once: vi.fn(), removeListener: vi.fn() };
const ipcEvent = { sender } as unknown as IpcMainInvokeEvent;
const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(ipcEvent, ...args);
const send = (channel: string, requestId: string, event = ipcEvent) =>
  listeners.get(channel)!(event as unknown as IpcMainEvent, requestId);

function register() {
  const host: VodIpcPort = {
    home: vi.fn(async (_key: string, _profileId?: string) => ({ list: [] })),
    category: vi.fn(async (_key: string, _tid: string, _pg: string, _extend: Record<string, string>, _profileId?: string) => ({ list: [] })),
    detail: vi.fn(async (_key: string, _ids: string[], _profileId?: string) => ({ list: [] })),
    search: vi.fn(async (_key: string, _wd: string, _profileId?: string) => ({ list: [] })),
    searchAll: vi.fn(async (_query: string, _options?: { refresh?: boolean; profileId?: string; profileIds?: string[] }, progress?: (event: SearchAllProgressEvent) => void, _signal?: AbortSignal) => {
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
    listeners.clear();
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

  it('forwards caller cancellation through IPC and scopes it to the initiating renderer', async () => {
    const { host } = register();
    vi.mocked(host.searchAll).mockImplementationOnce((_query, _options, _progress, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const request = invoke(IPC.VOD_SEARCH_ALL, { wd: 'film', requestId: 'request-a' });
    await vi.waitFor(() => expect(host.searchAll).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(host.searchAll).mock.calls[0][3];
    expect(signal?.aborted).toBe(false);

    const otherEvent = { sender: { ...sender, id: 2 } } as unknown as IpcMainEvent;
    send(IPC.VOD_SEARCH_ALL_CANCEL, 'request-a', otherEvent);
    expect(signal?.aborted).toBe(false);
    send(IPC.VOD_SEARCH_ALL_CANCEL, 'request-a');
    expect(signal?.aborted).toBe(true);
    await expect(request).resolves.toMatchObject({ ok: false, error: { message: '搜索已由调用窗口取消' } });
    expect(sender.removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });

  it('passes cancellation to the current-source request', async () => {
    const { host } = register();
    vi.mocked(host.search).mockImplementationOnce((_key, _wd, _profileId, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const request = invoke(IPC.VOD_SEARCH, { key: 'source-a', wd: 'film', requestId: 'single-a' });
    await vi.waitFor(() => expect(host.search).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(host.search).mock.calls[0][3];
    send(IPC.VOD_SEARCH_CANCEL, 'single-a');

    expect(signal?.aborted).toBe(true);
    await expect(request).resolves.toMatchObject({ ok: false, error: { message: '搜索已由调用窗口取消' } });
  });

  it('cancels home and category browse operations through sender-scoped IPC requests', async () => {
    const { host } = register();
    vi.mocked(host.home).mockImplementationOnce((_key, _profileId, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const homeRequest = invoke(IPC.VOD_HOME, { key: 'source-a', requestId: 'home-a' });
    await vi.waitFor(() => expect(host.home).toHaveBeenCalledTimes(1));
    const homeSignal = vi.mocked(host.home).mock.calls[0][2];
    send(IPC.VOD_HOME_CANCEL, 'home-a');
    expect(homeSignal?.aborted).toBe(true);
    await expect(homeRequest).resolves.toMatchObject({ ok: false, error: { message: '首页浏览已由调用窗口取消' } });

    vi.mocked(host.category).mockImplementationOnce((_key, _tid, _page, _extend, _profileId, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const categoryRequest = invoke(IPC.VOD_CATEGORY, {
      key: 'source-a', tid: 'genre', pg: '2', requestId: 'category-a',
    });
    await vi.waitFor(() => expect(host.category).toHaveBeenCalledTimes(1));
    const categorySignal = vi.mocked(host.category).mock.calls[0][5];
    send(IPC.VOD_CATEGORY_CANCEL, 'category-a');
    expect(categorySignal?.aborted).toBe(true);
    await expect(categoryRequest).resolves.toMatchObject({ ok: false, error: { message: '分类浏览已由调用窗口取消' } });
  });

  it('aborts active searches when their renderer window is destroyed', async () => {
    const { host } = register();
    vi.mocked(host.searchAll).mockImplementationOnce((_query, _options, _progress, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const request = invoke(IPC.VOD_SEARCH_ALL, { wd: 'film', requestId: 'closing-window' });
    await vi.waitFor(() => expect(host.searchAll).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(host.searchAll).mock.calls[0][3];
    const onDestroyed = sender.once.mock.calls.at(-1)?.[1] as (() => void) | undefined;
    expect(onDestroyed).toBeTypeOf('function');

    onDestroyed?.();

    expect(signal?.aborted).toBe(true);
    await expect(request).resolves.toMatchObject({ ok: false, error: { message: '搜索窗口已关闭' } });
  });
});
