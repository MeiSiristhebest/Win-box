// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { BackupOperationsPort } from '../src/renderer/features/settings/application/backupOperationsPort';
import type { BackupStoragePort } from '../src/renderer/features/settings/application/backupStoragePort';
import { useBackupSettingsPresenter } from '../src/renderer/features/settings/useBackupSettingsPresenter';

function setup(overrides: {
  backup?: Partial<BackupOperationsPort>;
  storage?: Partial<BackupStoragePort>;
} = {}) {
  const backup: BackupOperationsPort = {
    exportSnapshot: vi.fn().mockResolvedValue({ saved: true, path: 'backup.json' }),
    chooseImportFile: vi.fn().mockResolvedValue({ ok: true, restoreId: 'restore-1', renderer: { theme: 'dark' } }),
    commitImport: vi.fn().mockResolvedValue(undefined),
    cancelImport: vi.fn().mockResolvedValue(undefined),
    reloadAfterRestore: vi.fn(),
    ...overrides.backup,
  };
  const storage: BackupStoragePort = {
    collectSnapshot: vi.fn().mockReturnValue({ theme: 'light' }),
    prepareRestore: vi.fn().mockReturnValue({ rollback: vi.fn() }),
    ...overrides.storage,
  };
  const confirmImport = vi.fn().mockResolvedValue(true);
  return { backup, storage, confirmImport };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useBackupSettingsPresenter', () => {
  it('exports the renderer snapshot and reports the saved path', async () => {
    const ports = setup();
    const { result } = renderHook(() => useBackupSettingsPresenter(ports));

    await act(async () => { await result.current.actions.onExport(); });

    expect(ports.backup.exportSnapshot).toHaveBeenCalledWith({ theme: 'light' });
    expect(result.current.model.feedback).toEqual({ text: '已导出到：backup.json', kind: 'ok' });
    expect(result.current.model.busy).toBe(false);
  });

  it('does not open the import picker when the user declines confirmation', async () => {
    const ports = setup();
    ports.confirmImport.mockResolvedValue(false);
    const { result } = renderHook(() => useBackupSettingsPresenter(ports));

    await act(async () => { await result.current.actions.onImport(); });

    expect(ports.backup.chooseImportFile).not.toHaveBeenCalled();
    expect(ports.backup.commitImport).not.toHaveBeenCalled();
    expect(result.current.model.feedback).toBeNull();
    expect(result.current.model.busy).toBe(false);
  });

  it('applies the renderer snapshot, commits, then reloads after a confirmed import', async () => {
    const ports = setup();
    const { result } = renderHook(() => useBackupSettingsPresenter(ports));

    await act(async () => { await result.current.actions.onImport(); });

    expect(ports.storage.prepareRestore).toHaveBeenCalledWith({ theme: 'dark' });
    expect(ports.backup.commitImport).toHaveBeenCalledWith('restore-1');
    expect(ports.backup.reloadAfterRestore).toHaveBeenCalledOnce();
    expect(ports.backup.cancelImport).not.toHaveBeenCalled();
    expect(result.current.model.busy).toBe(false);
  });

  it('always attempts session cleanup when commit and local rollback fail', async () => {
    const rollback = vi.fn(() => { throw new Error('rollback failed'); });
    const ports = setup({
      backup: { commitImport: vi.fn().mockRejectedValue(new Error('commit failed')) },
      storage: { prepareRestore: vi.fn().mockReturnValue({ rollback }) },
    });
    const { result } = renderHook(() => useBackupSettingsPresenter(ports));

    await act(async () => { await result.current.actions.onImport(); });

    expect(rollback).toHaveBeenCalledOnce();
    expect(ports.backup.cancelImport).toHaveBeenCalledWith('restore-1');
    expect(result.current.model.feedback).toEqual({
      text: 'commit failed；本地数据回滚失败：rollback failed',
      kind: 'err',
    });
    expect(ports.backup.reloadAfterRestore).not.toHaveBeenCalled();
    expect(result.current.model.busy).toBe(false);
  });

  it('cancels the staged session when preparing local storage fails', async () => {
    const ports = setup({ storage: { prepareRestore: vi.fn(() => { throw new Error('storage unavailable'); }) } });
    const { result } = renderHook(() => useBackupSettingsPresenter(ports));

    await act(async () => { await result.current.actions.onImport(); });

    expect(ports.backup.cancelImport).toHaveBeenCalledWith('restore-1');
    expect(result.current.model.feedback).toEqual({ text: 'storage unavailable', kind: 'err' });
    expect(result.current.model.busy).toBe(false);
  });
});
