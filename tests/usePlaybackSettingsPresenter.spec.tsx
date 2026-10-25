// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../src/shared/player';
import { DEFAULT_PLAYER_PREFS, type PlayerPreferencesPort, type PlayerPrefs } from '../src/renderer/features/playback/application/playerPreferences';
import type { PlayerSettingsPort } from '../src/renderer/features/settings/application/playbackSettingsPorts';
import { usePlaybackSettingsPresenter } from '../src/renderer/features/settings/usePlaybackSettingsPresenter';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let savedPreferences: PlayerPrefs;
const preferences: PlayerPreferencesPort = {
  load: vi.fn(() => ({ ...savedPreferences })),
  save: vi.fn(patch => { savedPreferences = { ...savedPreferences, ...patch }; }),
};

function createSettingsPort(initial: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS }): PlayerSettingsPort & {
  getSettings: () => PlayerSettings;
} {
  let settings = initial;
  return {
    loadSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async patch => {
      settings = { ...settings, ...patch };
      return settings;
    }),
    getSettings: () => settings,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  savedPreferences = { ...DEFAULT_PLAYER_PREFS };
});

describe('usePlaybackSettingsPresenter', () => {
  it('does not load local or shared playback preferences while inactive', () => {
    const playerSettings = createSettingsPort();
    renderHook(() => usePlaybackSettingsPresenter({
      active: false,
      requestedSection: '',
      preferences,
      playerSettings,
    }));

    expect(preferences.load).not.toHaveBeenCalled();
    expect(playerSettings.loadSettings).not.toHaveBeenCalled();
  });

  it('loads mode and shared settings independently and opens the requested advanced section', async () => {
    savedPreferences = { ...DEFAULT_PLAYER_PREFS, kernel: 'html5' };
    const playerSettings = createSettingsPort({ ...DEFAULT_PLAYER_SETTINGS, m3u8Purify: true });
    const { result } = renderHook(() => usePlaybackSettingsPresenter({
      active: true,
      requestedSection: 'mpv-kernel',
      preferences,
      playerSettings,
    }));

    expect(result.current.model.advancedOpen).toBe(true);
    await waitFor(() => expect(result.current.model.settingsLoaded).toBe(true));
    expect(result.current.model.internalMode).toBe('html5');
    expect(result.current.model.settings.m3u8Purify).toBe(true);
    expect(preferences.load).toHaveBeenCalledOnce();
  });

  it('saves the selected mode through its preference port and reports failure without throwing', async () => {
    const playerSettings = createSettingsPort();
    const { result } = renderHook(() => usePlaybackSettingsPresenter({
      active: true,
      requestedSection: '',
      preferences,
      playerSettings,
    }));

    await waitFor(() => expect(result.current.model.settingsLoaded).toBe(true));

    act(() => result.current.actions.selectInternalMode('html5'));
    expect(preferences.save).toHaveBeenCalledWith({ kernel: 'html5' });
    expect(result.current.model.internalMode).toBe('html5');
    expect(result.current.model.message).toMatchObject({ kind: 'ok' });

    vi.mocked(preferences.save).mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    act(() => result.current.actions.selectInternalMode('mpv'));
    expect(result.current.model.internalMode).toBe('html5');
    expect(result.current.model.message).toEqual({ text: '播放方式保存失败：disk unavailable', kind: 'err' });
  });

  it('persists M3U8 preference through the settings port and publishes the returned settings', async () => {
    const playerSettings = createSettingsPort();
    const { result } = renderHook(() => usePlaybackSettingsPresenter({
      active: true,
      requestedSection: '',
      preferences,
      playerSettings,
    }));

    await waitFor(() => expect(result.current.model.settingsLoaded).toBe(true));
    await act(async () => result.current.actions.toggleM3u8Purify(true));

    expect(playerSettings.saveSettings).toHaveBeenCalledWith({ m3u8Purify: true });
    expect(result.current.model.settings.m3u8Purify).toBe(true);
    expect(result.current.model.message).toEqual({ text: '已开启：播放点播时清除清单中的广告分段', kind: 'ok' });
  });
});
