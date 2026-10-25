export interface SettingsMessage {
  text: string;
  kind: 'ok' | 'err';
}

export interface NetworkSettingsViewModel {
  loadState: 'loading' | 'ready' | 'error';
  enabled: boolean;
  url: string;
  saving: boolean;
  message: SettingsMessage | null;
}

export interface NetworkSettingsViewActions {
  setEnabled(enabled: boolean): void;
  setUrl(url: string): void;
  save(): Promise<void>;
  retryLoad(): void;
}
