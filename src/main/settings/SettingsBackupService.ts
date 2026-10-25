import type { BackupSettingsState } from '../../shared/backup';

export type BackupSettingsSlice = Pick<
  BackupSettingsState,
  'userConfig' | 'driveTokens' | 'subtitle' | 'metaSettings' | 'danmaku'
>;

export interface SettingsBackupPorts {
  userConfig: {
    snapshot(): BackupSettingsState['userConfig'];
    restore(value: BackupSettingsState['userConfig']): void;
  };
  drives: {
    list(): Record<string, string>;
    set(provider: string, token: string): unknown;
    remove(provider: string): unknown;
  };
  subtitle: {
    getSettings(): BackupSettingsState['subtitle'];
    setSettings(value: BackupSettingsState['subtitle']): void;
  };
  metadata: {
    settingsSnapshot(): BackupSettingsState['metaSettings'];
    restoreSettings(value: BackupSettingsState['metaSettings']): void;
  };
  danmaku: {
    getSettings(): BackupSettingsState['danmaku'];
    setSettings(value: BackupSettingsState['danmaku']): void;
  };
  driveRuntime: {
    resetAfterCredentialChange(): void;
    syncCredentialFiles(): void;
  };
}

/** Coordinates the host-owned part of backup and restore through settings-domain ports. */
export class SettingsBackupService {
  constructor(private readonly ports: SettingsBackupPorts) {}

  snapshot(): BackupSettingsSlice {
    return {
      userConfig: this.ports.userConfig.snapshot(),
      driveTokens: this.ports.drives.list(),
      subtitle: this.ports.subtitle.getSettings(),
      metaSettings: this.ports.metadata.settingsSnapshot(),
      danmaku: this.ports.danmaku.getSettings(),
    };
  }

  restore(state: Partial<BackupSettingsState>): void {
    if (state.userConfig) this.ports.userConfig.restore(state.userConfig);
    if (state.driveTokens && typeof state.driveTokens === 'object') {
      const desired = state.driveTokens;
      for (const provider of Object.keys(this.ports.drives.list())) {
        if (!(provider in desired)) this.ports.drives.remove(provider);
      }
      for (const [provider, token] of Object.entries(desired)) {
        if (provider && typeof token === 'string' && token.trim()) this.ports.drives.set(provider, token);
      }
      this.ports.driveRuntime.resetAfterCredentialChange();
    }

    // Some legacy spiders read credential files directly instead of the injected drive-token map.
    this.ports.driveRuntime.syncCredentialFiles();
    if (state.subtitle) this.ports.subtitle.setSettings(state.subtitle);
    if (state.metaSettings) this.ports.metadata.restoreSettings(state.metaSettings);
    if (state.danmaku) this.ports.danmaku.setSettings(state.danmaku);
  }
}
