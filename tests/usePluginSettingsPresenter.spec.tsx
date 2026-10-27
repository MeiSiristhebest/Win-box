// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PluginSettingsDependencies } from '../src/renderer/features/settings/application/settingsSectionPorts';
import type { PluginView, SettingsPanelView } from '../src/shared/plugin';
import { usePluginSettingsPresenter } from '../src/renderer/features/settings/usePluginSettingsPresenter';

const plugin: PluginView = {
  id: 'sample-plugin',
  name: 'Sample',
  version: '1.0.0',
  source: 'user',
  level: 'L1',
  kind: 'asset',
  permissions: [],
  enabled: true,
  ready: true,
  modes: [],
};

const panel: SettingsPanelView = {
  id: 'settings',
  pluginId: plugin.id,
  pluginName: plugin.name,
  label: '设置',
  fields: [],
};

function createDependencies(): PluginSettingsDependencies {
  return {
    catalog: {
      listPlugins: vi.fn().mockResolvedValue([plugin]),
      listPanels: vi.fn().mockResolvedValue([panel]),
      listCommands: vi.fn().mockResolvedValue([]),
      inspectInstallSource: vi.fn().mockResolvedValue({ canceled: false, ok: true, path: 'sample.winbox', name: 'Code fixture', kind: 'code', permissions: ['net'], permissionNotes: { net: '联网能力' } }),
    },
    lifecycle: {
      install: vi.fn().mockResolvedValue({ ok: true, items: [plugin] }),
      uninstall: vi.fn().mockResolvedValue({ ok: true, items: [] }),
      setEnabled: vi.fn().mockResolvedValue({ ok: true, items: [plugin] }),
    },
    panels: { save: vi.fn().mockResolvedValue({ ok: true, panels: [panel] }) },
    commands: { execute: vi.fn().mockResolvedValue({ ok: true, message: '已执行' }) },
    skins: { reload: vi.fn().mockResolvedValue(undefined) },
    events: { notifyChanged: vi.fn() },
  };
}

describe('usePluginSettingsPresenter', () => {
  it('cancels code plugin installation when the user rejects the permission request', async () => {
    const dependencies = createDependencies();
    const confirm = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() => usePluginSettingsPresenter(dependencies, confirm, true));

    await waitFor(() => expect(result.current.pluginsStatus).toBe('ready'));
    await act(async () => { await result.current.installPlugin(); });

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('net：联网能力'), expect.objectContaining({ title: '确认插件权限' }));
    expect(dependencies.lifecycle.install).not.toHaveBeenCalled();
    expect(dependencies.events.notifyChanged).not.toHaveBeenCalled();
  });

  it('reports lifecycle failure and does not announce or reload a mutation that did not succeed', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.catalog.inspectInstallSource).mockResolvedValue({ canceled: false, ok: true, path: 'sample.winbox', kind: 'asset' });
    vi.mocked(dependencies.lifecycle.install).mockResolvedValue({ ok: false, reason: 'archive rejected' });
    const { result } = renderHook(() => usePluginSettingsPresenter(dependencies, vi.fn().mockResolvedValue(true), true));

    await act(async () => { await result.current.installPlugin(); });

    expect(result.current.pluginMessage).toEqual({ text: 'archive rejected', kind: 'err' });
    expect(dependencies.events.notifyChanged).not.toHaveBeenCalled();
    expect(dependencies.skins.reload).not.toHaveBeenCalled();
  });

  it('keeps settings-load failure distinct from an empty plugin list', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.catalog.listPlugins).mockRejectedValue(new Error('catalog unavailable'));
    const { result } = renderHook(() => usePluginSettingsPresenter(dependencies, vi.fn(), true));

    await waitFor(() => expect(result.current.pluginsStatus).toBe('failed'));

    expect(result.current.pluginItems).toEqual([]);
    expect(result.current.loadErrors).toContain('插件列表加载失败：catalog unavailable');
  });

  it('returns false and preserves the current panel snapshot when a setting save fails', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.panels.save).mockResolvedValue({ ok: false, reason: 'write denied' });
    const { result } = renderHook(() => usePluginSettingsPresenter(dependencies, vi.fn(), true));
    await waitFor(() => expect(result.current.panelsStatus).toBe('ready'));

    let saved = true;
    await act(async () => { saved = await result.current.saveSetting(plugin.id, panel.id, 'quality', 'high'); });

    expect(saved).toBe(false);
    expect(result.current.panels).toEqual([panel]);
    expect(result.current.pluginMessage).toEqual({ text: 'write denied', kind: 'err' });
  });

  it('publishes the latest panel snapshot before reporting a successful setting save', async () => {
    const dependencies = createDependencies();
    const updatedPanel = { ...panel, label: '保存后的设置' };
    vi.mocked(dependencies.panels.save).mockResolvedValue({ ok: true, panels: [updatedPanel] });
    const { result } = renderHook(() => usePluginSettingsPresenter(dependencies, vi.fn(), true));
    await waitFor(() => expect(result.current.panelsStatus).toBe('ready'));

    let saved = false;
    await act(async () => { saved = await result.current.saveSetting(plugin.id, panel.id, 'quality', 'high'); });

    expect(saved).toBe(true);
    expect(result.current.panels).toEqual([updatedPanel]);
    expect(result.current.pluginMessage).toEqual({ text: '设置已保存', kind: 'ok' });
  });

  it('reports refresh failure as a warning and still acknowledges a successful save', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.panels.save).mockResolvedValue({ ok: true, refreshError: 'panel read failed' });
    const { result } = renderHook(() => usePluginSettingsPresenter(dependencies, vi.fn(), true));
    await waitFor(() => expect(result.current.panelsStatus).toBe('ready'));

    let saved = false;
    await act(async () => { saved = await result.current.saveSetting(plugin.id, panel.id, 'quality', 'high'); });

    expect(saved).toBe(true);
    expect(result.current.panels).toEqual([panel]);
    expect(result.current.pluginMessage).toEqual({ text: '设置已保存，但面板刷新失败：panel read failed', kind: 'warn' });
  });
});
