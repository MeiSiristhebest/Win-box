import { useCallback, useEffect, useState } from 'react';
import type { PlayerSettings } from '../../../shared/player';
import type { ExternalPlayerDiscoveryPort, ExternalPlayerOption, PlayerSettingsWritePort } from './application/playbackSettingsPorts';

type SettingsMessage = { text: string; kind: 'ok' | 'err' };

interface ExternalPlayerSettingsOptions {
  active: boolean;
  settingsLoaded: boolean;
  settings: PlayerSettings;
  settingsWriter: PlayerSettingsWritePort;
  discovery: ExternalPlayerDiscoveryPort;
  onSettingsSaved: (settings: PlayerSettings) => void;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useExternalPlayerSettings({ active, settingsLoaded, settings, settingsWriter, discovery, onSettingsSaved }: ExternalPlayerSettingsOptions) {
  const [torrentDraft, setTorrentDraft] = useState<string | null>(null);
  const [torrentPlayers, setTorrentPlayers] = useState<ExternalPlayerOption[]>([]);
  const [torrentMessage, setTorrentMessage] = useState<SettingsMessage | null>(null);
  const [vodDraft, setVodDraft] = useState<string | null>(null);
  const [vodPlayers, setVodPlayers] = useState<ExternalPlayerOption[]>([]);
  const [vodMessage, setVodMessage] = useState<SettingsMessage | null>(null);
  const [vodBusy, setVodBusy] = useState(false);
  const torrentValue = torrentDraft ?? settings.btExternalPlayer;
  const vodValue = vodDraft ?? settings.vodExternalPlayer;

  useEffect(() => {
    if (!active || !settingsLoaded || !settings.vodExternalPlayer) return;
    let current = true;
    void discovery.detectVodPlayers()
      .then(players => { if (current) setVodPlayers(players); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [active, discovery, settings.vodExternalPlayer, settingsLoaded]);

  const detectTorrentPlayers = useCallback(async () => {
    if (!settingsLoaded) return;
    try {
      const players = await discovery.detectTorrentPlayers();
      setTorrentPlayers(players);
      setTorrentMessage(players.length
        ? { text: '选择一个播放器即可保存', kind: 'ok' }
        : { text: '未检测到常见播放器：可安装 PotPlayer / VLC / mpv / MPC-HC，或手动粘贴播放器 exe 路径', kind: 'err' });
    } catch (error) {
      setTorrentMessage({ text: `检测失败：${describeFailure(error)}`, kind: 'err' });
    }
  }, [discovery, settingsLoaded]);

  const saveTorrentPlayer = useCallback(async (path = torrentValue) => {
    if (!settingsLoaded) return;
    try {
      const nextSettings = await settingsWriter.saveSettings({ btExternalPlayer: path.trim() });
      onSettingsSaved(nextSettings);
      setTorrentDraft(null);
      setTorrentMessage({
        text: nextSettings.btExternalPlayer
          ? '已保存：磁力的 MKV / HEVC 将用该播放器打开'
          : '已清空：恢复自动检测（PotPlayer → VLC → mpv → MPC-HC）',
        kind: 'ok',
      });
    } catch (error) {
      setTorrentMessage({ text: `保存失败：${describeFailure(error)}`, kind: 'err' });
    }
  }, [onSettingsSaved, settingsLoaded, settingsWriter, torrentValue]);

  const detectVodPlayers = useCallback(async () => {
    if (!settingsLoaded) return;
    setVodBusy(true);
    try {
      const players = await discovery.detectVodPlayers();
      setVodPlayers(players);
      setVodMessage(players.length
        ? { text: '选择一个播放器即可保存；是否用于点播由上方开关决定', kind: 'ok' }
        : { text: '未检测到常见播放器：可安装 PotPlayer / VLC / mpv / MPC-HC，或手动粘贴播放器 exe 路径', kind: 'err' });
    } catch (error) {
      setVodMessage({ text: `检测失败：${describeFailure(error)}`, kind: 'err' });
    } finally {
      setVodBusy(false);
    }
  }, [discovery, settingsLoaded]);

  const toggleVodPlayerEnabled = useCallback(async (enabled: boolean) => {
    if (!settingsLoaded) return;
    setVodBusy(true);
    try {
      let path = (vodDraft ?? settings.vodExternalPlayer).trim();
      if (enabled && !path) {
        const players = await discovery.detectVodPlayers();
        setVodPlayers(players);
        path = players[0]?.path || '';
      }
      const nextSettings = await settingsWriter.saveSettings({
        vodExternalPlayerEnabled: enabled,
        ...(enabled && path ? { vodExternalPlayer: path } : {}),
      });
      onSettingsSaved(nextSettings);
      if (enabled && path) setVodDraft(null);
      setVodMessage(!enabled
        ? { text: '已改用应用内播放', kind: 'ok' }
        : path
          ? { text: '已启用：可直接播放的地址会交给所选播放器；需要网页解析或网盘授权时会先说明原因，再询问是否改用应用内播放', kind: 'ok' }
          : { text: '未检测到可用播放器。可安装 PotPlayer 后重新检测，或在下方填写路径；目前继续使用应用内播放。', kind: 'err' });
    } catch (error) {
      setVodMessage({ text: `保存失败：${describeFailure(error)}`, kind: 'err' });
    } finally {
      setVodBusy(false);
    }
  }, [discovery, onSettingsSaved, settings.vodExternalPlayer, settingsLoaded, settingsWriter, vodDraft]);

  const saveVodPlayer = useCallback(async (path = vodValue) => {
    if (!settingsLoaded) return;
    setVodBusy(true);
    try {
      const nextSettings = await settingsWriter.saveSettings({ vodExternalPlayer: path.trim() });
      onSettingsSaved(nextSettings);
      setVodDraft(null);
      setVodMessage({
        text: nextSettings.vodExternalPlayer
          ? nextSettings.vodExternalPlayerEnabled
            ? '已保存：可直接播放的地址会交给该播放器，并会从历史位置续播'
            : '已保存路径；当前未启用外部播放器，点播仍用内置播放器'
          : '已清空：点播改用内置播放器',
        kind: 'ok',
      });
    } catch (error) {
      setVodMessage({ text: `保存失败：${describeFailure(error)}`, kind: 'err' });
    } finally {
      setVodBusy(false);
    }
  }, [onSettingsSaved, settingsLoaded, settingsWriter, vodValue]);

  return {
    torrent: {
      value: torrentValue,
      players: torrentPlayers,
      message: torrentMessage,
      setDraft: setTorrentDraft,
      detect: detectTorrentPlayers,
      save: saveTorrentPlayer,
    },
    vod: {
      value: vodValue,
      players: vodPlayers,
      message: vodMessage,
      busy: vodBusy,
      setDraft: setVodDraft,
      detect: detectVodPlayers,
      toggleEnabled: toggleVodPlayerEnabled,
      save: saveVodPlayer,
    },
  };
}
