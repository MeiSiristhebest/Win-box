import { useCallback, useEffect, useState } from 'react';
import type { BossKeySettings } from '../../../shared/types';
import type { ShortcutSettingsPort } from './application/settingsSectionPorts';
import { DEFAULT_BOSS_KEY_ACCELERATOR, bossKeyAcceleratorFromStroke, type BossKeyStroke } from './application/bossKeyAccelerator';
import { formatBossKeyAccelerator } from './presentation/bossKeyAcceleratorLabel';

export type ShortcutSettingsFeedback = { text: string; kind: 'ok' | 'err' };

export type ShortcutSettingsViewModel = {
  loading: boolean;
  saving: boolean;
  bossKey: BossKeySettings | null;
  acceleratorDraft: string;
  acceleratorDisplay: string;
  feedback: ShortcutSettingsFeedback | null;
};

export type ShortcutSettingsActions = {
  onToggleEnabled(enabled: boolean): void;
  onCaptureAccelerator(stroke: BossKeyStroke): void;
  onSave(): void;
  onCancelDraft(): void;
};

export function useShortcutSettingsPresenter(active: boolean, port: ShortcutSettingsPort) {
  const [bossKey, setBossKey] = useState<BossKeySettings | null>(null);
  const [acceleratorDraft, setAcceleratorDraft] = useState('');
  const [feedback, setFeedback] = useState<ShortcutSettingsFeedback | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void port.loadBossKey().then((settings) => {
      if (current) setBossKey(settings);
    }).catch(() => {
      if (current) setBossKey({ enabled: false, accel: DEFAULT_BOSS_KEY_ACCELERATOR });
    });
    return () => { current = false; };
  }, [active, port]);

  const onToggleEnabled = useCallback((enabled: boolean) => {
    setBossKey((current) => current ? { ...current, enabled } : current);
  }, []);

  const onCaptureAccelerator = useCallback((stroke: BossKeyStroke) => {
    const accelerator = bossKeyAcceleratorFromStroke(stroke);
    if (accelerator) {
      setAcceleratorDraft(accelerator);
      setFeedback(null);
    }
  }, []);

  const onSave = useCallback(async () => {
    if (!bossKey || saving) return;
    setSaving(true);
    const accelerator = (acceleratorDraft || bossKey.accel).trim();
    try {
      const result = await port.saveBossKey({ enabled: bossKey.enabled, accel: accelerator });
      setBossKey(result.settings);
      setAcceleratorDraft('');
      if (result.settings.enabled && !result.registered) {
        setFeedback({ text: '快捷键注册失败：可能已被其它程序占用，请换一个组合', kind: 'err' });
      } else {
        setFeedback({ text: result.settings.enabled ? `已启用：${formatBossKeyAccelerator(result.settings.accel)}` : '已停用老板键', kind: 'ok' });
      }
    } catch (cause: unknown) {
      setFeedback({ text: `保存失败：${cause instanceof Error ? cause.message : String(cause)}`, kind: 'err' });
    } finally {
      setSaving(false);
    }
  }, [acceleratorDraft, bossKey, port, saving]);

  const model: ShortcutSettingsViewModel = {
    loading: active && bossKey === null,
    saving,
    bossKey,
    acceleratorDraft,
    acceleratorDisplay: formatBossKeyAccelerator(acceleratorDraft || bossKey?.accel || DEFAULT_BOSS_KEY_ACCELERATOR),
    feedback,
  };
  const actions: ShortcutSettingsActions = {
    onToggleEnabled,
    onCaptureAccelerator,
    onSave: () => { void onSave(); },
    onCancelDraft: () => setAcceleratorDraft(''),
  };

  return { model, actions };
}
