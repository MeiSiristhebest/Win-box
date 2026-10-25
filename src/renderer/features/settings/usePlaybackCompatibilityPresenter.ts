import { useCallback, useEffect, useRef, useState } from 'react';
import type { MpvStatus, PlayerSettings } from '../../../shared/player';
import type {
  MpvSettingsPort,
  PlayerSettingsReadPort,
  PlayerSettingsWritePort,
} from './application/playbackSettingsPorts';
import type {
  PlaybackCompatibilityMessage,
  PlaybackCompatibilityViewModel,
} from './playbackCompatibilityViewModel';

interface PlaybackCompatibilityPresenterOptions {
  active: boolean;
  settingsLoaded: boolean;
  settings: PlayerSettings;
  settingsReader: PlayerSettingsReadPort;
  settingsWriter: PlayerSettingsWritePort;
  statusQuery: MpvSettingsPort;
  onSettingsSaved(settings: PlayerSettings): void;
  onAvailabilityChange(available: boolean): void;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeStatus(status: MpvStatus | null): string {
  if (!status) return '正在检查…';
  return (status.available ? '已就绪：' : '暂不可用：') + status.note;
}

export function usePlaybackCompatibilityPresenter({
  active,
  settingsLoaded,
  settings,
  settingsReader,
  settingsWriter,
  statusQuery,
  onSettingsSaved,
  onAvailabilityChange,
}: PlaybackCompatibilityPresenterOptions) {
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<MpvStatus | null>(null);
  const [message, setMessage] = useState<PlaybackCompatibilityMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void statusQuery.loadStatus()
      .then(nextStatus => {
        if (!current) return;
        setStatus(nextStatus);
        onAvailabilityChange(nextStatus.available);
      })
      .catch(() => {
        if (!current) return;
        setStatus({ available: false, path: '', source: 'none', note: '兼容播放组件检测失败，可先使用标准播放或外部播放器' });
        onAvailabilityChange(false);
      });
    return () => { current = false; };
  }, [active, onAvailabilityChange, statusQuery]);

  const refreshAfterInstall = useCallback(async () => {
    const [nextSettings, nextStatus] = await Promise.all([settingsReader.loadSettings(), statusQuery.loadStatus()]);
    if (!mounted.current) return;
    onSettingsSaved(nextSettings);
    setPathDraft(null);
    setStatus(nextStatus);
    onAvailabilityChange(nextStatus.available);
  }, [onAvailabilityChange, onSettingsSaved, settingsReader, statusQuery]);

  const savePath = useCallback(async () => {
    if (!settingsLoaded || saving) return;
    setSaving(true);
    try {
      const nextSettings = await settingsWriter.saveSettings({ mpvPath: (pathDraft ?? settings.mpvPath).trim() });
      if (!mounted.current) return;
      onSettingsSaved(nextSettings);
      setPathDraft(null);

      try {
        const nextStatus = await statusQuery.loadStatus();
        if (!mounted.current) return;
        setStatus(nextStatus);
        onAvailabilityChange(nextStatus.available);
        setMessage({
          text: nextStatus.available ? `已保存：MPV 内核${nextStatus.note}` : `已保存，但该路径不可用：${nextStatus.note}`,
          kind: nextStatus.available ? 'ok' : 'err',
        });
      } catch (error) {
        if (!mounted.current) return;
        setMessage({ text: `已保存，但兼容组件状态刷新失败：${describeFailure(error)}`, kind: 'err' });
      }
    } catch (error) {
      if (mounted.current) setMessage({ text: `保存失败：${describeFailure(error)}`, kind: 'err' });
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [onAvailabilityChange, onSettingsSaved, pathDraft, saving, settings.mpvPath, settingsLoaded, settingsWriter, statusQuery]);

  const model: PlaybackCompatibilityViewModel = {
    path: pathDraft ?? settings.mpvPath,
    settingsLoaded,
    saving,
    statusLabel: describeStatus(status),
    message,
  };

  return {
    model,
    actions: { setPathDraft, savePath },
    refreshAfterInstall,
  };
}
