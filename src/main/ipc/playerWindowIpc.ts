import type { PlayerEpisodeSwitch } from '../../shared/playerEpisode';
import { IPC } from '../../shared/ipc-channels';
import type { Logger } from '../../shared/types';
import type { PlayerInit } from '../player/PlayerWindow';
import { registerHandler } from '../util/ipcGuard';

/** Window operations exposed to the IPC adapter; renderer input stays at this boundary. */
export interface PlayerWindowPort {
  open(init: PlayerInit): void;
  switchEpisode(request: number | PlayerEpisodeSwitch): boolean;
  isOpen(): boolean;
  resendInit(): void;
  setMini(mini: boolean): void;
  isMini(): boolean;
  setFullscreen(fullscreen: boolean): Promise<boolean>;
  isFullscreen(): boolean;
  setResizable(resizable: boolean): boolean;
  close(): void;
}

export function registerPlayerWindowIpc(
  player: PlayerWindowPort,
  logger: Logger,
  notifyWindowState: (open: boolean) => void,
): void {
  registerHandler(IPC.PLAYER_OPEN, (_event, init: PlayerInit) => {
    player.open(init);
    notifyWindowState(true);
    return { ok: true };
  }, logger);
  registerHandler(IPC.PLAYER_SWITCH_EP, (_event, request: number | PlayerEpisodeSwitch) => ({
    switched: player.switchEpisode(request),
  }), logger);
  registerHandler(IPC.PLAYER_IS_OPEN, () => ({ open: player.isOpen() }), logger);
  registerHandler(IPC.PLAYER_GET_INIT, () => ({ open: player.isOpen() }), logger);
  registerHandler(IPC.PLAYER_READY, () => {
    player.resendInit();
    return { ok: true };
  }, logger);
  registerHandler(IPC.PLAYER_SET_MINI, (_event, mini: boolean) => {
    player.setMini(!!mini);
    return { mini: player.isMini() };
  }, logger);
  registerHandler(IPC.PLAYER_IS_MINI, () => ({ mini: player.isMini() }), logger);
  registerHandler(IPC.PLAYER_SET_FULLSCREEN, async (_event, fullscreen: boolean) => ({
    fullscreen: await player.setFullscreen(!!fullscreen),
  }), logger);
  registerHandler(IPC.PLAYER_IS_FULLSCREEN, () => ({ fullscreen: player.isFullscreen() }), logger);
  registerHandler(IPC.PLAYER_SET_RESIZABLE, (_event, resizable: boolean) => ({
    resizable: player.setResizable(!!resizable),
  }), logger);
  registerHandler('player:close', () => {
    player.close();
    return { ok: true };
  }, logger);
}
