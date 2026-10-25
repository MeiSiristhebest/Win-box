import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { Logger } from '../src/shared/types';
import { IPC } from '../src/shared/ipc-channels';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}));

import { registerPlayerWindowIpc, type PlayerWindowPort } from '../src/main/ipc/playerWindowIpc';
import type { PlayerInit } from '../src/main/player/PlayerWindow';

const logger = { i: vi.fn(), w: vi.fn(), e: vi.fn(), d: vi.fn() } as unknown as Logger;
const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: {} } as IpcMainInvokeEvent, ...args);

function register() {
  const player: PlayerWindowPort = {
    open: vi.fn(),
    switchEpisode: vi.fn(() => true),
    isOpen: vi.fn(() => true),
    resendInit: vi.fn(),
    setMini: vi.fn(),
    isMini: vi.fn(() => false),
    setFullscreen: vi.fn(async (fullscreen: boolean) => fullscreen),
    isFullscreen: vi.fn(() => false),
    setResizable: vi.fn((resizable: boolean) => resizable),
    close: vi.fn(),
  };
  const notifyWindowState = vi.fn();
  registerPlayerWindowIpc(player, logger, notifyWindowState);
  return { player, notifyWindowState };
}

describe('player window IPC adapter', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('opens the window and notifies other surfaces with the existing result shape', async () => {
    const { player, notifyWindowState } = register();
    const init: PlayerInit = {
      key: 'source-a',
      flag: 'line-a',
      episodes: [{ name: '第01集', url: 'https://media.example/video.m3u8' }],
      epIndex: 0,
      title: '测试影片',
      lastUrl: 'https://media.example/video.m3u8',
      lastName: '测试影片 - 第01集',
    };

    await expect(invoke(IPC.PLAYER_OPEN, init)).resolves.toEqual({ ok: true, data: { ok: true } });
    expect(player.open).toHaveBeenCalledWith(init);
    expect(notifyWindowState).toHaveBeenCalledWith(true);
  });

  it('delegates lifecycle and window state commands while preserving response envelopes', async () => {
    const { player } = register();

    await expect(invoke(IPC.PLAYER_SWITCH_EP, 2)).resolves.toEqual({ ok: true, data: { switched: true } });
    await expect(invoke(IPC.PLAYER_SET_MINI, true)).resolves.toEqual({ ok: true, data: { mini: false } });
    await expect(invoke(IPC.PLAYER_SET_FULLSCREEN, true)).resolves.toEqual({ ok: true, data: { fullscreen: true } });
    await expect(invoke(IPC.PLAYER_SET_RESIZABLE, false)).resolves.toEqual({ ok: true, data: { resizable: false } });
    await expect(invoke('player:close')).resolves.toEqual({ ok: true, data: { ok: true } });

    expect(player.switchEpisode).toHaveBeenCalledWith(2);
    expect(player.setMini).toHaveBeenCalledWith(true);
    expect(player.setFullscreen).toHaveBeenCalledWith(true);
    expect(player.setResizable).toHaveBeenCalledWith(false);
    expect(player.close).toHaveBeenCalledOnce();
  });
});
