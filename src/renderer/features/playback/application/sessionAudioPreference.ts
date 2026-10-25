/** Remembers the user's preferred track across episode component remounts. */
export interface SessionAudioPreferencePort {
  readPreferredTrackKey(): string;
  rememberPreferredTrackKey(key: string): void;
}
