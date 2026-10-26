// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PlayerEngineView } from '../src/shared/plugin';
import { DEFAULT_PLAYER_SETTINGS } from '../src/shared/player';
import type { PlayerEngineSettingsEventsPort } from '../src/renderer/features/settings/application/settingsSectionPorts';
import type { PlayerEngineActivationPort, PlayerEngineCatalogPort, PlayerEnginePathSettingsPort } from '../src/renderer/features/settings/application/playerEngineSettingsPorts';
import { usePlayerEngineSettingsPresenter } from '../src/renderer/features/settings/usePlayerEngineSettingsPresenter';

const engine: PlayerEngineView = {
  id: 'engine:sample',
  pluginId: 'sample-plugin',
  pluginName: 'Sample',
  label: 'Sample Engine',
  capabilities: ['seek'],
  source: 'local-path',
  ready: false,
  note: '尚未配置路径',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('usePlayerEngineSettingsPresenter', () => {
  it('filters built-in engines and honors enable confirmation', async () => {
    let settings = { ...DEFAULT_PLAYER_SETTINGS };
    const builtin = { ...engine, id: 'builtin', pluginId: 'builtin' };
    const catalog: PlayerEngineCatalogPort = { listEngines: vi.fn().mockResolvedValue([builtin, engine]) };
    const activation: PlayerEngineActivationPort = {
      setEngineEnabled: vi.fn().mockImplementation(async ({ id, enabled }) => {
        settings = { ...settings, engineEnabled: { ...settings.engineEnabled, [id]: enabled } };
        return { ok: true };
      }),
    };
    const pathSettings: PlayerEnginePathSettingsPort = {
      loadPlayerSettings: vi.fn().mockImplementation(async () => settings),
      savePlayerSettings: vi.fn().mockImplementation(async (patch) => {
        settings = { ...settings, ...patch };
        return settings;
      }),
    };
    const events: PlayerEngineSettingsEventsPort = { notifyChanged: vi.fn() };
    const confirmEnable = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => usePlayerEngineSettingsPresenter({
      active: true, catalog, activation, pathSettings, events, confirmEnable,
    }));

    await waitFor(() => expect(result.current.model.loading).toBe(false));
    expect(result.current.model.items.map((item) => item.id)).toEqual([engine.id]);

    await act(async () => { await result.current.toggle(engine, true); });
    expect(activation.setEngineEnabled).not.toHaveBeenCalled();

    await act(async () => { await result.current.toggle(engine, true); });
    expect(activation.setEngineEnabled).toHaveBeenCalledWith({ id: engine.id, enabled: true });
    expect(result.current.model.settings.engineEnabled[engine.id]).toBe(true);
    expect(events.notifyChanged).toHaveBeenCalledOnce();
  });

  it('saves a trimmed local path and reports failures', async () => {
    const settings = { ...DEFAULT_PLAYER_SETTINGS };
    const catalog: PlayerEngineCatalogPort = { listEngines: vi.fn().mockResolvedValue([engine]) };
    const activation: PlayerEngineActivationPort = { setEngineEnabled: vi.fn().mockResolvedValue({ ok: true }) };
    const pathSettings: PlayerEnginePathSettingsPort = {
      loadPlayerSettings: vi.fn().mockResolvedValue(settings),
      savePlayerSettings: vi.fn().mockRejectedValue(new Error('path write failed')),
    };
    const { result } = renderHook(() => usePlayerEngineSettingsPresenter({
      active: true, catalog, activation, pathSettings,
      events: { notifyChanged: vi.fn() },
      confirmEnable: vi.fn().mockResolvedValue(true),
    }));

    await waitFor(() => expect(result.current.model.loading).toBe(false));
    act(() => result.current.changePath(engine.id, '  D:\\Players\\engine.exe  '));
    await act(async () => { await result.current.savePath(engine); });

    expect(pathSettings.savePlayerSettings).toHaveBeenCalledWith({
      enginePaths: { ...settings.enginePaths, [engine.id]: 'D:\\Players\\engine.exe' },
    });
    expect(result.current.model.error).toBe('path write failed');
    expect(result.current.model.busy).toBe(false);
  });
});
