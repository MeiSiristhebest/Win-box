import { afterEach, describe, expect, it } from 'vitest';
import {
  sessionAudioPreferenceMemoryAdapter,
} from '../src/renderer/features/playback/adapters/sessionAudioPreferenceMemoryAdapter';

afterEach(() => sessionAudioPreferenceMemoryAdapter.rememberPreferredTrackKey(''));

describe('session audio preference', () => {
  it('retains the selected track key across playback component remounts', () => {
    sessionAudioPreferenceMemoryAdapter.rememberPreferredTrackKey('mpv\u0000audio-track-2');

    expect(sessionAudioPreferenceMemoryAdapter.readPreferredTrackKey()).toBe('mpv\u0000audio-track-2');
  });

  it('clears the session preference when the user has no remembered choice', () => {
    sessionAudioPreferenceMemoryAdapter.rememberPreferredTrackKey('mpv\u0000audio-track-2');
    sessionAudioPreferenceMemoryAdapter.rememberPreferredTrackKey('');

    expect(sessionAudioPreferenceMemoryAdapter.readPreferredTrackKey()).toBe('');
  });
});
