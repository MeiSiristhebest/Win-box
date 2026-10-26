import { useEffect, useState } from 'react';
import { DEFAULT_META_SETTINGS, type MetaSettings } from '../../../shared/meta';
import type { MetaSettingsPort } from './application/metaSettingsPort';

export interface MetaSettingsViewModel {
  loaded: boolean;
  draft: MetaSettings;
  dirty: boolean;
  saving: boolean;
  message: { text: string; kind: 'ok' | 'err' } | null;
  loadError: string;
}

export function useMetaSettingsPresenter(port: MetaSettingsPort, notifyChanged: () => void) {
  const [model, setModel] = useState<MetaSettingsViewModel>({
    loaded: false,
    draft: { ...DEFAULT_META_SETTINGS },
    dirty: false,
    saving: false,
    message: null,
    loadError: '',
  });

  useEffect(() => {
    let current = true;
    void port.getSettings()
      .then((settings) => {
        if (!current) return;
        setModel((previous) => ({ ...previous, loaded: true, draft: toMetaSettings(settings), loadError: '' }));
      })
      .catch((error: unknown) => {
        if (current) setModel((previous) => ({ ...previous, loaded: true, loadError: errorMessage(error) }));
      });
    return () => { current = false; };
  }, [port]);

  function change(field: keyof MetaSettings, value: string) {
    setModel((current) => ({
      ...current,
      draft: { ...current.draft, [field]: value },
      dirty: true,
      message: null,
    }));
  }

  async function save() {
    if (!model.dirty || model.saving) return;
    setModel((current) => ({ ...current, saving: true, message: null }));
    try {
      const settings = await port.saveSettings(model.draft);
      setModel((current) => ({
        ...current,
        draft: toMetaSettings(settings),
        dirty: false,
        message: { text: '已保存，立即生效。', kind: 'ok' },
      }));
      notifyChanged();
    } catch (error) {
      setModel((current) => ({ ...current, message: { text: '保存失败：' + errorMessage(error), kind: 'err' } }));
    } finally {
      setModel((current) => ({ ...current, saving: false }));
    }
  }

  return { model, change, save };
}

function toMetaSettings(settings: MetaSettings): MetaSettings {
  return {
    tmdbApiKey: settings.tmdbApiKey,
    tmdbApiBase: settings.tmdbApiBase,
    tmdbImageBase: settings.tmdbImageBase,
    metaSource: settings.metaSource,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
