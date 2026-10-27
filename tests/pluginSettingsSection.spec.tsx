// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PluginSettingsDependencies } from '../src/renderer/features/settings/application/settingsSectionPorts';
import type { UiCommandView } from '../src/shared/plugin';
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
});
