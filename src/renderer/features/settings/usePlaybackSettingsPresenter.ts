import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../../../shared/player';
import type { KernelPref } from '../../lib/kernel';
import type { PlayerPreferencesPort } from '../playback/application/playerPreferences';
import type { PlayerSettingsPort } from './application/playbackSettingsPorts';

type SettingsMessage = { text: string; kind: 'ok' | 'err' };

interface PlaybackSettingsPresenterOptions {
  active: boolean;
  requestedSection: string;
  preferences: PlayerPreferencesPort;
  playerSettings: PlayerSettingsPort;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePlaybackSettingsPresenter({ active, requestedSection, preferences, playerSettings }: PlaybackSettingsPresenterOptions) {
  const [settings, setSettings] = useState<PlayerSettings>({ ...DEFAULT_PLAYER_SETTINGS });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [message, setMessage] = useState<SettingsMessage | null>(null);
  const [internalMode, setInternalMode] = useState<KernelPref>('auto');
  const [advancedOpen, setAdvancedOpen] = useState(() => ['mpv-kernel', 'bt-player', 'plugin-engines', 'media-runtimes'].includes(requestedSection));
  const [mpvAvailable, setMpvAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    try {
      // oxlint-disable-next-line react/set-state-in-effect -- The view becomes active later; synchronize its local model from the preference port on activation.
      setInternalMode(preferences.load().kernel);
    } catch (error) {
      setMessage({ text: `本地播放偏好读取失败：${describeFailure(error)}`, kind: 'err' });
    }
    void playerSettings.loadSettings()
      .then(nextSettings => {
        if (!current) return;
        setSettings(nextSettings);
        setSettingsLoaded(true);
      })
      .catch(() => {
        if (current) setMessage({ text: '播放设置读取失败，请重新打开此页后再保存', kind: 'err' });
      });
    return () => { current = false; };
  }, [active, playerSettings, preferences]);

  const selectInternalMode = useCallback((mode: KernelPref) => {
    try {
      preferences.save({ kernel: mode });
      setInternalMode(mode);
      setMessage({ text: '已保存，下次打开应用内播放器时生效', kind: 'ok' });
    } catch (error) {
      setMessage({ text: `播放方式保存失败：${describeFailure(error)}`, kind: 'err' });
    }
  }, [preferences]);

  const toggleM3u8Purify = useCallback(async (enabled: boolean) => {
    if (!settingsLoaded) return;
    try {
      const nextSettings = await playerSettings.saveSettings({ m3u8Purify: enabled });
      setSettings(nextSettings);
      setMessage({ text: enabled ? '已开启：播放点播时清除清单中的广告分段' : '已关闭', kind: 'ok' });
    } catch (error) {
      setMessage({ text: `保存失败：${describeFailure(error)}`, kind: 'err' });
    }
  }, [playerSettings, settingsLoaded]);

  const acceptSavedPlayerSettings = useCallback((nextSettings: PlayerSettings) => {
    setSettings(nextSettings);
  }, []);

  const setAdvancedSectionExpanded = useCallback((expanded: boolean) => {
    setAdvancedOpen(expanded);
  }, []);

  const reportCompatibilityAvailability = useCallback((available: boolean | null) => {
    setMpvAvailable(available);
  }, []);

  return {
    model: { settings, settingsLoaded, message, internalMode, advancedOpen, mpvAvailable },
    actions: {
      selectInternalMode,
      toggleM3u8Purify,
      acceptSavedPlayerSettings,
      setAdvancedSectionExpanded,
      reportCompatibilityAvailability,
    },
  };
}
