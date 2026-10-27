// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PluginSettingsDependencies } from '../src/renderer/features/settings/application/settingsSectionPorts';
import type { PluginView, UiCommandView } from '../src/shared/plugin';
import { PluginSettingsSection } from '../src/renderer/features/settings/PluginSettingsSection';

vi.mock('../src/renderer/components/AppDialog', () => ({
  useAppDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

const command: UiCommandView = {
  id: 'open-home',
  pluginId: 'sample-plugin',
  pluginName: 'Sample',
  label: '打开首页',
  placement: ['config'],
  action: 'navigate',
  to: 'home',
};

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

function dependencies(): PluginSettingsDependencies {
  return {
    catalog: {
      listPlugins: vi.fn().mockResolvedValue([]),
      listPanels: vi.fn().mockResolvedValue([]),
      listCommands: vi.fn().mockResolvedValue([command]),
      inspectInstallSource: vi.fn().mockResolvedValue({ canceled: true, ok: false }),
    },
    lifecycle: {
      install: vi.fn().mockResolvedValue({ ok: true }),
      uninstall: vi.fn().mockResolvedValue({ ok: true }),
      setEnabled: vi.fn().mockResolvedValue({ ok: true }),
    },
    panels: { save: vi.fn().mockResolvedValue({ ok: true, panels: [] }) },
    commands: { execute: vi.fn().mockResolvedValue({ ok: true, message: '已跳转' }) },
    skins: { reload: vi.fn().mockResolvedValue(undefined) },
    events: { notifyChanged: vi.fn() },
  };
}

afterEach(() => cleanup());

describe('PluginSettingsSection', () => {
  it('loads commands and delegates execution through the injected command port', async () => {
    const ports = dependencies();
    render(<PluginSettingsSection active dependencies={ports} />);

    fireEvent.click(await screen.findByRole('button', { name: '打开首页' }));
    expect(ports.commands.execute).toHaveBeenCalledWith(command, expect.any(Function));
  });

  it('uses the catalog and lifecycle ports for an inspected install', async () => {
    const ports = dependencies();
    vi.mocked(ports.catalog.inspectInstallSource).mockResolvedValue({
      canceled: false,
      ok: true,
      path: 'sample.winbox',
      kind: 'asset',
    });
    render(<PluginSettingsSection active dependencies={ports} />);

    fireEvent.click(screen.getByRole('button', { name: '安装插件…' }));
    await vi.waitFor(() => expect(ports.catalog.inspectInstallSource).toHaveBeenCalledOnce());
    expect(ports.lifecycle.install).toHaveBeenCalledWith('sample.winbox');
  });

  it('shows an explicit loading state and prevents duplicate refresh while plugins are loading', async () => {
    const ports = dependencies();
    let resolvePlugins: ((items: PluginView[]) => void) | undefined;
    vi.mocked(ports.catalog.listPlugins).mockImplementation(() => new Promise((resolve) => {
      resolvePlugins = resolve;
    }));
    render(<PluginSettingsSection active dependencies={ports} />);

    expect(await screen.findByText('正在加载插件…')).toBeTruthy();
    expect((screen.getByRole('button', { name: '刷新' }) as HTMLButtonElement).disabled).toBe(true);

    resolvePlugins?.([]);
    expect(await screen.findByText('共 0 个')).toBeTruthy();
  });

  it('reflects the selected enabled state and disables lifecycle controls while a change is pending', async () => {
    const ports = dependencies();
    const disabledPlugin = { ...plugin, enabled: false };
    vi.mocked(ports.catalog.listPlugins)
      .mockResolvedValueOnce([plugin])
      .mockResolvedValue([disabledPlugin]);
    let completeToggle: ((result: { ok: boolean; items: PluginView[] }) => void) | undefined;
    vi.mocked(ports.lifecycle.setEnabled).mockImplementation(() => new Promise((resolve) => {
      completeToggle = resolve;
    }));
    render(<PluginSettingsSection active dependencies={ports} />);

    const enabledControl = await screen.findByRole('checkbox', { name: '启用' }) as HTMLInputElement;
    expect(enabledControl.checked).toBe(true);
    fireEvent.click(enabledControl);

    await vi.waitFor(() => expect(ports.lifecycle.setEnabled).toHaveBeenCalledWith({ id: plugin.id, enabled: false }));
    expect(enabledControl.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '安装插件…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '卸载' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      completeToggle?.({ ok: true, items: [disabledPlugin] });
    });
    await vi.waitFor(() => expect(enabledControl.checked).toBe(false));
    expect(enabledControl.disabled).toBe(false);
  });
});
