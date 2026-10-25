import type { Logger } from '../../shared/types';
import type { PlayerSettings } from '../../shared/player';
import type { ExternalPlayer, PlayerLaunchResult } from './externalPlayer';

export interface ExternalPlaybackSettingsPort {
  readonly settings: Pick<PlayerSettings, 'btExternalPlayer' | 'vodExternalPlayer' | 'vodExternalPlayerEnabled'>;
}

export interface ExternalPlayerRuntimePort {
  detectPlayers(overridePath?: string): ExternalPlayer[];
  resolvePlayer(path: string): ExternalPlayer | null;
  launchPlayer(path: string, url: string, extraArgs?: string[]): Promise<PlayerLaunchResult>;
  seekArgs(playerId: string, seconds: number): string[];
  normalizeExecutablePath(path: string): string;
}

export interface ExternalPlaybackDependencies {
  settings: ExternalPlaybackSettingsPort;
  players: ExternalPlayerRuntimePort;
  logger: Pick<Logger, 'i' | 'w'>;
}

export interface ExternalPlaybackRequest {
  url?: string;
  path?: string;
  seek?: number;
}

export interface ExternalPlaybackResult {
  ok: boolean;
  player?: string;
  error?: string;
}

/** Coordinates external-player policy while keeping IPC and OS process APIs outside the use case. */
export class ExternalPlayback {
  constructor(private readonly dependencies: ExternalPlaybackDependencies) {}

  magnetPlayers(): ExternalPlayer[] {
    return this.dependencies.players.detectPlayers(this.dependencies.settings.settings.btExternalPlayer);
  }

  vodPlayers(): ExternalPlayer[] {
    return this.dependencies.players.detectPlayers(this.dependencies.settings.settings.vodExternalPlayer);
  }

  async openVod(request: ExternalPlaybackRequest): Promise<ExternalPlaybackResult> {
    const { settings, players, logger } = this.dependencies;
    if (!settings.settings.vodExternalPlayerEnabled) {
      return { ok: false, error: '点播外部播放器未启用（请在配置页「播放」中勾选「启用点播外部播放器」）' };
    }
    const url = String(request?.url || '').trim();
    if (!url) return { ok: false, error: '地址为空' };
    const configuredPath = players.normalizeExecutablePath(request?.path || settings.settings.vodExternalPlayer);
    const player = configuredPath ? players.resolvePlayer(configuredPath) : players.detectPlayers()[0];
    if (!player) {
      return {
        ok: false,
        error: configuredPath
          ? '指定的播放器路径不存在或无法访问：' + configuredPath
          : '未检测到本机播放器（可在配置页「播放」中填写播放器路径）',
      };
    }
    const seek = Math.max(0, Math.floor(Number(request?.seek) || 0));
    const started = await players.launchPlayer(player.path, url, players.seekArgs(player.id, seek));
    if (!started.ok) {
      logger.w('vod: 外部播放器「' + player.name + '」启动失败：' + (started.error || '未知错误'));
      return { ok: false, error: started.error || '无法启动「' + player.name + '」' };
    }
    logger.i('vod: 外部播放器接力「' + player.name + '」' + (seek > 0 ? '（起播 ' + seek + 's）' : '') + '→ ' + url.slice(0, 120));
    return { ok: true, player: player.name };
  }

  async openWebDav(value: string): Promise<ExternalPlaybackResult> {
    const { settings, players, logger } = this.dependencies;
    const url = String(value || '').trim();
    if (!url) return { ok: false, error: '地址为空' };
    const configuredPath = players.normalizeExecutablePath(settings.settings.btExternalPlayer);
    const player = configuredPath ? players.resolvePlayer(configuredPath) : players.detectPlayers()[0];
    if (!player) {
      return {
        ok: false,
        error: configuredPath
          ? '指定的播放器路径不存在或无法访问：' + configuredPath
          : '未检测到本机播放器（可在配置页「播放」中填写播放器路径）',
      };
    }
    const started = await players.launchPlayer(player.path, url);
    if (!started.ok) {
      logger.w('webdav: 外部播放器「' + player.name + '」启动失败：' + (started.error || '未知错误'));
      return { ok: false, error: started.error || '无法启动「' + player.name + '」' };
    }
    logger.i('webdav: 外部播放器接力「' + player.name + '」→ ' + url.slice(0, 120));
    return { ok: true, player: player.name };
  }
}
