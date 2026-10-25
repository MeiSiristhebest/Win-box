// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_PREFS } from '../src/renderer/features/playback/application/playerPreferences';
import { loadPlayerPrefs, savePlayerPrefs } from '../src/renderer/lib/playerPrefs';

const STORAGE_KEY = 'winbox-player-prefs';

afterEach(() => {
  localStorage.clear();
});

describe('player preferences browser storage adapter', () => {
  it('returns normalized defaults when storage is empty or malformed', () => {
    expect(loadPlayerPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(loadPlayerPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it('merges a partial preference update without losing the other saved values', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_PLAYER_PREFS, rate: 1.5, kernel: 'mpv' }));

    savePlayerPrefs({ vol: 0.4 });

    expect(loadPlayerPrefs()).toMatchObject({ vol: 0.4, rate: 1.5, kernel: 'mpv' });
  });
});
