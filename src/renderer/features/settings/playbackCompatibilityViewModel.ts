export type PlaybackCompatibilityMessage = {
  text: string;
  kind: 'ok' | 'err';
};

export interface PlaybackCompatibilityViewModel {
  path: string;
  settingsLoaded: boolean;
  saving: boolean;
  statusLabel: string;
  message: PlaybackCompatibilityMessage | null;
}

export interface PlaybackCompatibilityViewActions {
  setPathDraft(value: string): void;
  savePath(): Promise<void>;
}
