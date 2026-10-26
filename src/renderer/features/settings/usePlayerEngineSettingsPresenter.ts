import { useEffect, useRef, useState } from 'react';
import type { PlayerEngineView } from '../../../shared/plugin';
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../../../shared/player';
import type { PlayerEngineSettingsEventsPort } from './application/settingsSectionPorts';
import type { PlayerEngineActivationPort, PlayerEngineCatalogPort, PlayerEnginePathSettingsPort } from './application/playerEngineSettingsPorts';

export interface PlayerEngineSettingsViewModel {
  items: PlayerEngineView[];
  settings: PlayerSettings;
  drafts: Record<string, string>;
  busy: boolean;
  loading: boolean;
  error: string;
}

interface PlayerEngineSettingsPresenterOptions {
  active: boolean;
  catalog: PlayerEngineCatalogPort;
  activation: PlayerEngineActivationPort;
  pathSettings: PlayerEnginePathSettingsPort;
  events: PlayerEngineSettingsEventsPort;
  confirmEnable(item: PlayerEngineView): Promise<boolean>;
}

const INITIAL_MODEL: PlayerEngineSettingsViewModel = {
  items: [],
  settings: DEFAULT_PLAYER_SETTINGS,
  drafts: {},
  busy: false,
  loading: true,
  error: '',
};

export function usePlayerEngineSettingsPresenter({
  active, catalog, activation, pathSettings, events, confirmEnable,
}: PlayerEngineSettingsPresenterOptions) {
  const [model, setModel] = useState(INITIAL_MODEL);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void loadSettings(catalog, pathSettings)
      .then((loaded) => {
        if (current) setModel((previous) => ({ ...previous, ...loaded }));
      })
      .catch((error: unknown) => {
        if (current) setModel((previous) => ({ ...previous, error: errorMessage(error) }));
      })
      .finally(() => {
        if (current) setModel((previous) => ({ ...previous, loading: false }));
      });
    return () => { current = false; };
  }, [active, catalog, pathSettings]);

  async function toggle(item: PlayerEngineView, enabled: boolean) {
    if (model.busy) return;
    setModel((previous) => ({ ...previous, busy: true, error: '' }));
    try {
      if (enabled && !model.settings.engineEnabled[item.id] && !(await confirmEnable(item))) return;
      const result = await activation.setEngineEnabled({ id: item.id, enabled });
      if (!result.ok) throw new Error(result.reason || '保存失败');
      events.notifyChanged();
      const loaded = await loadSettings(catalog, pathSettings);
      if (mounted.current) setModel((previous) => ({ ...previous, ...loaded }));
    } catch (error) {
      if (mounted.current) setModel((previous) => ({ ...previous, error: errorMessage(error) }));
    } finally {
      if (mounted.current) setModel((previous) => ({ ...previous, busy: false }));
    }
  }

  function changePath(itemId: string, path: string) {
    setModel((previous) => ({ ...previous, drafts: { ...previous.drafts, [itemId]: path } }));
  }

  async function savePath(item: PlayerEngineView) {
    if (model.busy) return;
    const path = (model.drafts[item.id] ?? model.settings.enginePaths[item.id] ?? '').trim();
    setModel((previous) => ({ ...previous, busy: true, error: '' }));
    try {
      await pathSettings.savePlayerSettings({ enginePaths: { ...model.settings.enginePaths, [item.id]: path } });
      events.notifyChanged();
      const loaded = await loadSettings(catalog, pathSettings);
      if (mounted.current) setModel((previous) => ({ ...previous, ...loaded, drafts: { ...previous.drafts, [item.id]: path } }));
    } catch (error) {
      if (mounted.current) setModel((previous) => ({ ...previous, error: errorMessage(error) }));
    } finally {
      if (mounted.current) setModel((previous) => ({ ...previous, busy: false }));
    }
  }

  return { model, toggle, changePath, savePath };
}

async function loadSettings(catalog: PlayerEngineCatalogPort, pathSettings: PlayerEnginePathSettingsPort) {
  const [engines, settings] = await Promise.all([catalog.listEngines(), pathSettings.loadPlayerSettings()]);
  return { items: engines.filter((item) => item.pluginId !== 'builtin'), settings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
