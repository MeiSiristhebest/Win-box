import { describe, expect, it, vi } from 'vitest';
import type { SettingsPanelView } from '../src/shared/plugin';
import { savePluginPanelSetting } from '../src/renderer/features/settings/application/savePluginPanelSetting';

const updatedPanel: SettingsPanelView = {
  id: 'settings',
  pluginId: 'sample-plugin',
  pluginName: 'Sample',
  label: '设置',
  fields: [],
};

describe('savePluginPanelSetting', () => {
  it('reloads the current panels when a legacy save response omits the snapshot', async () => {
    const gateway = {
      save: vi.fn().mockResolvedValue({ ok: true }),
      loadPanels: vi.fn().mockResolvedValue([updatedPanel]),
    };

    await expect(savePluginPanelSetting(gateway, { id: 'sample-plugin', panelId: 'settings', key: 'quality', value: 'high' }))
      .resolves.toEqual({ ok: true, panels: [updatedPanel] });
    expect(gateway.loadPanels).toHaveBeenCalledOnce();
  });

  it('uses a snapshot included with the save response without an extra load', async () => {
    const gateway = {
      save: vi.fn().mockResolvedValue({ ok: true, panels: [updatedPanel] }),
      loadPanels: vi.fn(),
    };

    await expect(savePluginPanelSetting(gateway, { id: 'sample-plugin', panelId: 'settings', key: 'quality', value: 'high' }))
      .resolves.toEqual({ ok: true, panels: [updatedPanel] });
    expect(gateway.loadPanels).not.toHaveBeenCalled();
  });

  it('does not reload panels after a failed save', async () => {
    const gateway = {
      save: vi.fn().mockResolvedValue({ ok: false, reason: 'write denied' }),
      loadPanels: vi.fn(),
    };

    await expect(savePluginPanelSetting(gateway, { id: 'sample-plugin', panelId: 'settings', key: 'quality', value: 'high' }))
      .resolves.toEqual({ ok: false, reason: 'write denied' });
    expect(gateway.loadPanels).not.toHaveBeenCalled();
  });

  it('preserves save success when reloading the snapshot fails', async () => {
    const gateway = {
      save: vi.fn().mockResolvedValue({ ok: true }),
      loadPanels: vi.fn().mockRejectedValue(new Error('panel read failed')),
    };

    await expect(savePluginPanelSetting(gateway, { id: 'sample-plugin', panelId: 'settings', key: 'quality', value: 'high' }))
      .resolves.toEqual({ ok: true, refreshError: 'panel read failed' });
    expect(gateway.save).toHaveBeenCalledOnce();
  });
});
