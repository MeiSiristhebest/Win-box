import type {
  MediaRuntimeId,
  MediaRuntimeProgress,
  MediaRuntimeStatus,
  MpvStatus,
  PlayerSettings,
} from '../../../../shared/player';

export interface PlayerSettingsReadPort {
  loadSettings(): Promise<PlayerSettings>;
}

export interface PlayerSettingsWritePort {
  saveSettings(patch: Partial<PlayerSettings>): Promise<PlayerSettings>;
}

export interface PlayerSettingsPort extends PlayerSettingsReadPort, PlayerSettingsWritePort {}

export interface ExternalPlayerOption {
  id: string;
  name: string;
  path: string;
}

export interface ExternalPlayerDiscoveryPort {
  detectTorrentPlayers(): Promise<ExternalPlayerOption[]>;
  detectVodPlayers(): Promise<ExternalPlayerOption[]>;
}

export interface MpvSettingsPort {
  loadStatus(): Promise<MpvStatus>;
}

export interface MediaRuntimeManagementPort {
  loadStatus(): Promise<MediaRuntimeStatus>;
  install(runtime: MediaRuntimeId): Promise<MediaRuntimeStatus>;
  cancelInstall(): Promise<boolean>;
  onProgress(listener: (progress: MediaRuntimeProgress) => void): () => void;
}
