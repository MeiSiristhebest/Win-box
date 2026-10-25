import { client } from '../../../api/client';
import type {
  ExternalPlayerDiscoveryPort,
  MediaRuntimeManagementPort,
  MpvSettingsPort,
  PlayerSettingsPort,
} from '../application/playbackSettingsPorts';

export const playerSettingsAdapter: PlayerSettingsPort = {
  loadSettings: () => client.playerPrefsGet(),
  saveSettings: (patch) => client.playerPrefsSet(patch),
};

export const externalPlayerDiscoveryAdapter: ExternalPlayerDiscoveryPort = {
  detectTorrentPlayers: () => client.btDetectPlayers(),
  detectVodPlayers: () => client.vodDetectPlayers(),
};

export const mpvSettingsAdapter: MpvSettingsPort = {
  loadStatus: () => client.mpvStatus(),
};

export const mediaRuntimeManagementAdapter: MediaRuntimeManagementPort = {
  loadStatus: () => client.mediaRuntimeStatus(),
  install: (runtime) => client.mediaRuntimeInstall(runtime),
  cancelInstall: () => client.mediaRuntimeCancel(),
  onProgress: (listener) => client.mediaRuntimeOnProgress(listener),
};
