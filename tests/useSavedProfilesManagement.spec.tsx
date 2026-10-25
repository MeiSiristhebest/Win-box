// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedProfilesManagementPort } from '../src/renderer/features/subscriptions/application/savedProfilesManagementPort';
import { useSavedProfilesManagement } from '../src/renderer/features/subscriptions/useSavedProfilesManagement';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const port: SavedProfilesManagementPort = {
  saveCurrentProfile: vi.fn(async () => undefined),
  renameProfile: vi.fn(async () => undefined),
  deleteProfile: vi.fn(async () => undefined),
};
const onRefresh = vi.fn(async () => undefined);

beforeEach(() => vi.clearAllMocks());

describe('useSavedProfilesManagement', () => {
  it('saves a trimmed profile name and refreshes the profile list', async () => {
    const { result } = renderHook(() => useSavedProfilesManagement({ port, onRefresh }));
    act(() => result.current.actions.changeProfileName('  电影配置  '));

    await act(async () => result.current.actions.saveProfile());

    expect(port.saveCurrentProfile).toHaveBeenCalledWith('电影配置');
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result.current.model.profileName).toBe('');
    expect(result.current.model.saving).toBe(false);
  });

  it('uses a default name when the input contains only whitespace', async () => {
    const { result } = renderHook(() => useSavedProfilesManagement({ port, onRefresh }));
    act(() => result.current.actions.changeProfileName('   '));

    await act(async () => result.current.actions.saveProfile());

    expect(port.saveCurrentProfile).toHaveBeenCalledWith('未命名配置');
  });

  it('trims nonempty rename input and skips empty values', async () => {
    const { result } = renderHook(() => useSavedProfilesManagement({ port, onRefresh }));
    act(() => result.current.actions.beginRename('profile-1', '旧名称'));
    act(() => result.current.actions.changeRenameDraft(' 新名称 '));
    await act(async () => result.current.actions.saveRename('profile-1'));

    expect(port.renameProfile).toHaveBeenCalledWith({ id: 'profile-1', name: '新名称' });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result.current.model).toMatchObject({ renameId: null, renameDraft: '' });

    act(() => result.current.actions.beginRename('profile-2', '旧名称'));
    act(() => result.current.actions.changeRenameDraft('  '));
    await act(async () => result.current.actions.saveRename('profile-2'));
    expect(port.renameProfile).toHaveBeenCalledOnce();
  });

  it('deletes through the port and refreshes after success', async () => {
    const { result } = renderHook(() => useSavedProfilesManagement({ port, onRefresh }));

    await act(async () => result.current.actions.deleteProfile('profile-1'));

    expect(port.deleteProfile).toHaveBeenCalledWith('profile-1');
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('reports an unknown operation failure without requiring Error instances', async () => {
    vi.mocked(port.deleteProfile).mockRejectedValueOnce('store unavailable');
    const { result } = renderHook(() => useSavedProfilesManagement({ port, onRefresh }));

    await act(async () => result.current.actions.deleteProfile('profile-1'));

    expect(result.current.model.error).toBe('store unavailable');
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not submit a duplicate profile save while the first one is pending', async () => {
    let finish!: () => void;
    vi.mocked(port.saveCurrentProfile).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useSavedProfilesManagement({ port, onRefresh }));

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.actions.saveProfile();
      await Promise.resolve();
      await result.current.actions.saveProfile();
    });
    expect(port.saveCurrentProfile).toHaveBeenCalledOnce();

    await act(async () => { finish(); await first; });
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
