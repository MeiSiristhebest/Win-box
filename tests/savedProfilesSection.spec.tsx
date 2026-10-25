// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../src/shared/types';
import type { SavedProfilesManagementPort } from '../src/renderer/features/subscriptions/application/savedProfilesManagementPort';
import { SavedProfilesSection } from '../src/renderer/features/subscriptions/SavedProfilesSection';

describe('SavedProfilesSection', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'api'); });

  it('keeps profile drafts local and delegates profile operations', async () => {
    const managementPort: SavedProfilesManagementPort = {
      saveCurrentProfile: vi.fn(async () => undefined),
      renameProfile: vi.fn(async () => undefined),
      deleteProfile: vi.fn(async () => undefined),
    };
    const onActivate = vi.fn();
    const onRefresh = vi.fn(async () => undefined);
    const profiles: UserProfile[] = [
      { id: 'active', name: '当前订阅', apiUrl: '', json: '{}', sourceCount: 2, importedAt: '' },
      { id: 'other', name: '旧订阅', apiUrl: '', json: '{}', sourceCount: 4, importedAt: '' },
    ];
    render(<SavedProfilesSection profiles={profiles} activeProfileId="active" busy={false}
      onActivate={onActivate} onRefresh={onRefresh} managementPort={managementPort} />);

    fireEvent.click(screen.getByText(/已保存配置/));
    fireEvent.click(screen.getByRole('button', { name: '切换' }));
    expect(onActivate).toHaveBeenCalledWith('other');
    fireEvent.click(screen.getAllByTitle('重命名该配置')[1]);
    fireEvent.change(screen.getByDisplayValue('旧订阅'), { target: { value: '新名字' } });
    fireEvent.keyDown(screen.getByDisplayValue('新名字'), { key: 'Enter' });
    await waitFor(() => expect(managementPort.renameProfile).toHaveBeenCalledWith({ id: 'other', name: '新名字' }));

    fireEvent.change(screen.getByPlaceholderText('把当前源列表存为新配置的名称…'), { target: { value: '备份' } });
    fireEvent.click(screen.getByRole('button', { name: '存为新配置' }));
    await waitFor(() => expect(managementPort.saveCurrentProfile).toHaveBeenCalledWith('备份'));
    expect(managementPort.deleteProfile).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('shows profile operation and activation errors in the profile section', () => {
    const managementPort: SavedProfilesManagementPort = {
      saveCurrentProfile: vi.fn(async () => undefined),
      renameProfile: vi.fn(async () => undefined),
      deleteProfile: vi.fn(async () => undefined),
    };
    render(<SavedProfilesSection profiles={[]} activeProfileId="" busy={false}
      onActivate={vi.fn()} activationError="切换档案失败" onRefresh={vi.fn(async () => undefined)} managementPort={managementPort} />);

    expect(screen.getByRole('alert').textContent).toContain('切换档案失败');
  });
});
