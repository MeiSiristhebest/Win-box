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
