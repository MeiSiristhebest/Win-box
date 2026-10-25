import type { Logger } from '../../shared/types';
import { IPC } from '../../shared/ipc-channels';
import { registerHandler } from '../util/ipcGuard';
import type { ExternalPlayer } from '../torrent/externalPlayer';
import type { ExternalPlaybackRequest, ExternalPlaybackResult } from '../torrent/ExternalPlayback';

interface ExternalPlaybackPort {
  magnetPlayers(): ExternalPlayer[];
  vodPlayers(): ExternalPlayer[];
  openVod(request: ExternalPlaybackRequest): Promise<ExternalPlaybackResult>;
  openWebDav(url: string): Promise<ExternalPlaybackResult>;
}

export interface ExternalPlaybackIpcDependencies {
  logger: Logger;
  playback: ExternalPlaybackPort;
}

/** Bridges renderer requests to the external-playback use case. */
export function registerExternalPlaybackIpc({ logger, playback }: ExternalPlaybackIpcDependencies): void {
  const playerChoices = (players: ExternalPlayer[]) =>
    players.map(({ id, name, path }) => ({ id, name, path }));

  registerHandler(IPC.BT_DETECT_PLAYERS, () => playerChoices(playback.magnetPlayers()), logger);
  registerHandler(IPC.VOD_DETECT_PLAYERS, () => playerChoices(playback.vodPlayers()), logger);
  registerHandler(IPC.VOD_OPEN_EXTERNAL, (_event: unknown, request: ExternalPlaybackRequest) =>
    playback.openVod(request || {}), logger);
  registerHandler(IPC.DAV_OPEN_EXTERNAL, (_event: unknown, url: string) => playback.openWebDav(url), logger);
}
