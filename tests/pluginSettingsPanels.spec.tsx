// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsPanelView } from '../src/shared/plugin';
import { PluginSettingsPanels } from '../src/renderer/features/settings/PluginSettingsPanels';

const panel: SettingsPanelView = {
  id: 'settings',
  pluginId: 'sample-plugin',
  pluginName: 'Sample',
  label: '设置',
  fields: [{ key: 'quality', label: '画质', type: 'text', value: 'standard' }],
};

afterEach(cleanup);

describe('PluginSettingsPanels', () => {
  it('disables every declared field type while a plugin operation is pending', () => {
    const panelWithAllFieldTypes: SettingsPanelView = {
      ...panel,
      fields: [
        { key: 'enabled', label: '开关', type: 'toggle', value: true },
        { key: 'quality', label: '模式', type: 'select', value: 'standard', options: [{ value: 'standard', label: '标准' }] },
        { key: 'name', label: '名称', type: 'text', value: '样例' },
        { key: 'level', label: '阈值', type: 'number', value: 2, min: 1, max: 5 },
      ],
    };
    const onSave = vi.fn().mockResolvedValue(true);
    render(<PluginSettingsPanels pluginId="sample-plugin" panels={[panelWithAllFieldTypes]} busy onSave={onSave} />);

    expect((screen.getByLabelText('开关') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('模式') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('名称') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('阈值') as HTMLInputElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the edited field draft visible when persistence fails', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    render(<PluginSettingsPanels pluginId="sample-plugin" panels={[panel]} busy={false} onSave={onSave} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'cinema' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('sample-plugin', 'settings', 'quality', 'cinema'));
    expect(input.value).toBe('cinema');
  });

  it('clears a field draft when persistence succeeded but the snapshot refresh warned', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<PluginSettingsPanels pluginId="sample-plugin" panels={[panel]} busy={false} onSave={onSave} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'cinema' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('sample-plugin', 'settings', 'quality', 'cinema'));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('standard'));
  });
});
