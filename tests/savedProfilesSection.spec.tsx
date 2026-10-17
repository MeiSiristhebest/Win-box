// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../src/shared/types';
import { SavedProfilesSection } from '../src/renderer/features/subscriptions/SavedProfilesSection';

describe('SavedProfilesSection', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'api'); });

  it('keeps profile drafts local and delegates profile operations', async () => {
    const saveAsProfile = vi.fn(async () => ({ ok: true, data: undefined }));
    const updateProfileName = vi.fn(async () => ({ ok: true, data: undefined }));
    const deleteProfile = vi.fn(async () => ({ ok: true, data: undefined }));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { config: { saveAsProfile, updateProfileName, deleteProfile } },
    });
    const onActivate = vi.fn();
    const onRefresh = vi.fn(async () => undefined);
    const onError = vi.fn();
    const profiles: UserProfile[] = [
      { id: 'active', name: '当前订阅', apiUrl: '', json: '{}', sourceCount: 2, importedAt: '' },
      { id: 'other', name: '旧订阅', apiUrl: '', json: '{}', sourceCount: 4, importedAt: '' },
    ];
    render(<SavedProfilesSection profiles={profiles} activeProfileId="active" busy={false}
      onActivate={onActivate} onRefresh={onRefresh} onError={onError} />);

    fireEvent.click(screen.getByText(/已保存配置/));
    fireEvent.click(screen.getByRole('button', { name: '切换' }));
    expect(onActivate).toHaveBeenCalledWith('other');
    fireEvent.click(screen.getAllByTitle('重命名该配置')[1]);
    fireEvent.change(screen.getByDisplayValue('旧订阅'), { target: { value: '新名字' } });
    fireEvent.keyDown(screen.getByDisplayValue('新名字'), { key: 'Enter' });
    await waitFor(() => expect(updateProfileName).toHaveBeenCalledWith({ id: 'other', name: '新名字' }));

    fireEvent.change(screen.getByPlaceholderText('把当前源列表存为新配置的名称…'), { target: { value: '备份' } });
    fireEvent.click(screen.getByRole('button', { name: '存为新配置' }));
    await waitFor(() => expect(saveAsProfile).toHaveBeenCalledWith('备份'));
    expect(deleteProfile).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });
});
