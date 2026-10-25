import type { SessionAudioPreferencePort } from '../application/sessionAudioPreference';

/** Keeps the preferred audio track in memory for the lifetime of the renderer. */
let preferredTrackKey = '';

export const sessionAudioPreferenceMemoryAdapter: SessionAudioPreferencePort = {
  readPreferredTrackKey: () => preferredTrackKey,
  rememberPreferredTrackKey: (key) => { preferredTrackKey = String(key || ''); },
};
