// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import {
  DEFAULT_PLAYER_PREFS,
  type PlayerPreferencesPort,
  type PlayerPrefs,
} from '../src/renderer/features/playback/application/playerPreferences';
import {
  usePlayerPreferencePersistence,
  usePlayerPreferences,
} from '../src/renderer/features/playback/usePlayerPreferences';

function createPreferencesPort(initial: Partial<PlayerPrefs> = {}) {
  let saved: PlayerPrefs = { ...DEFAULT_PLAYER_PREFS, ...initial };
  const port: PlayerPreferencesPort = {
    load: () => ({ ...saved }),
    save: (patch) => { saved = { ...saved, ...patch }; },
  };
  return { port, read: () => ({ ...saved }) };
}

afterEach(cleanup);

describe('usePlayerPreferences', () => {
  it('loads preferences and synchronizes current subtitle offset without losing kernel choice', () => {
    const storage = createPreferencesPort({ vol: 0.7, rate: 1.25, subOffset: 3, fit: 'cover', kernel: 'mpv' });
    const { result } = renderHook(() => usePlayerPreferences(storage.port));

    expect(result.current.volume).toBe(0.7);
    expect(result.current.rate).toBe(1.25);
    expect(result.current.fit).toBe('cover');
    expect(result.current.kernelPreference).toBe('mpv');

    act(() => result.current.setVolume(0.45));
    act(() => result.current.syncPreferences(12));

    expect(result.current.preferencesRef.current).toMatchObject({ vol: 0.45, subOffset: 12, kernel: 'mpv' });
    expect(storage.read()).toMatchObject({ vol: 0.45, subOffset: 12, kernel: 'mpv' });
  });

  it('updates in-memory preferences for boss-key mute without persisting the temporary volume', () => {
    const saved = { ...DEFAULT_PLAYER_PREFS, vol: 0.8, subOffset: 4 };
    const storage = createPreferencesPort(saved);
    const { result } = renderHook(() => usePlayerPreferences(storage.port));

    act(() => {
      result.current.bossKeyActiveRef.current = true;
      result.current.setVolume(0);
    });
    act(() => result.current.syncPreferences(9));

    expect(storage.read()).toEqual(saved);
    expect(result.current.preferencesRef.current).toMatchObject({ vol: 0, subOffset: 9 });
  });

  it('persists preference changes through the port and keeps its volume mirror current', () => {
    const storage = createPreferencesPort({ vol: 0.7, subOffset: 3 });

    const { result } = renderHook(() => {
      const preferences = usePlayerPreferences(storage.port);
      const [subtitleOffset, setSubtitleOffset] = useState(3);
      usePlayerPreferencePersistence({
        volume: preferences.volume,
        rate: preferences.rate,
        subtitleOffset,
        fit: preferences.fit,
        spdif: preferences.spdif,
        volumeRef: preferences.volumeRef,
        syncPreferences: preferences.syncPreferences,
      });
      return { preferences, setSubtitleOffset };
    });

    act(() => result.current.preferences.setVolume(0.45));
    expect(result.current.preferences.volumeRef.current).toBe(0.45);
    expect(storage.read()).toMatchObject({ vol: 0.45, subOffset: 3 });

    act(() => result.current.setSubtitleOffset(12));
    expect(storage.read()).toMatchObject({ vol: 0.45, subOffset: 12 });
  });

  it('keeps boss-key mute transient when persistence runs from the preference boundary', () => {
    const saved = { ...DEFAULT_PLAYER_PREFS, vol: 0.8, subOffset: 4 };
    const storage = createPreferencesPort(saved);

    const { result } = renderHook(() => {
      const preferences = usePlayerPreferences(storage.port);
      const [subtitleOffset, setSubtitleOffset] = useState(4);
      usePlayerPreferencePersistence({
        volume: preferences.volume,
        rate: preferences.rate,
        subtitleOffset,
        fit: preferences.fit,
        spdif: preferences.spdif,
        volumeRef: preferences.volumeRef,
        syncPreferences: preferences.syncPreferences,
      });
      return { preferences, setSubtitleOffset };
    });

    act(() => {
      result.current.preferences.bossKeyActiveRef.current = true;
      result.current.preferences.setVolume(0);
      result.current.setSubtitleOffset(9);
    });

    expect(storage.read()).toEqual(saved);
    expect(result.current.preferences.preferencesRef.current).toMatchObject({ vol: 0, subOffset: 9 });
  });

  it('keeps and persists the live kernel preference through the port', () => {
    const storage = createPreferencesPort();
    const { result } = renderHook(() => usePlayerPreferences(storage.port));

    act(() => result.current.rememberKernelPreference('html5'));

    expect(result.current.kernelPreferenceRef.current).toBe('html5');
    expect(storage.read().kernel).toBe('html5');
  });
});
