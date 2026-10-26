import { useCallback, useRef, useState } from 'react';
import type { BackupOperationsPort } from './application/backupOperationsPort';
import type { BackupStoragePort } from './application/backupStoragePort';

export type BackupSettingsFeedback = { text: string; kind: 'ok' | 'err' };

export interface BackupSettingsPresenterOptions {
  backup: BackupOperationsPort;
  storage: BackupStoragePort;
  confirmImport(): Promise<boolean>;
}

export interface BackupSettingsViewModel {
  busy: boolean;
  feedback: BackupSettingsFeedback | null;
}

export interface BackupSettingsActions {
  onExport(): Promise<void>;
  onImport(): Promise<void>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function rollbackFailedImport(
  backup: BackupOperationsPort,
  restoreId: string,
  transaction: ReturnType<BackupStoragePort['prepareRestore']> | undefined,
  cause: unknown,
): Promise<never> {
  const cleanupFailures: string[] = [];
  try {
    transaction?.rollback();
  } catch (rollbackCause) {
    cleanupFailures.push(`本地数据回滚失败：${errorMessage(rollbackCause)}`);
  }
  try {
    await backup.cancelImport(restoreId);
  } catch (cancelCause) {
    cleanupFailures.push(`恢复会话清理失败：${errorMessage(cancelCause)}`);
  }
  const originalMessage = errorMessage(cause);
  if (cleanupFailures.length > 0) {
    throw new Error(`${originalMessage}；${cleanupFailures.join('；')}`);
  }
  throw cause;
}

export function useBackupSettingsPresenter({ backup, storage, confirmImport }: BackupSettingsPresenterOptions) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<BackupSettingsFeedback | null>(null);
  const operationRunning = useRef(false);

  const beginOperation = useCallback(() => {
    if (operationRunning.current) return false;
    operationRunning.current = true;
    setBusy(true);
    setFeedback(null);
    return true;
  }, []);

  const endOperation = useCallback(() => {
    operationRunning.current = false;
    setBusy(false);
  }, []);

  const onExport = useCallback(async () => {
    if (!beginOperation()) return;
    try {
      const result = await backup.exportSnapshot(storage.collectSnapshot());
      setFeedback(result.saved
        ? { text: `已导出到：${result.path}`, kind: 'ok' }
        : { text: '已取消导出', kind: 'ok' });
    } catch (cause) {
      setFeedback({ text: errorMessage(cause), kind: 'err' });
    } finally {
      endOperation();
    }
  }, [backup, beginOperation, endOperation, storage]);

  const onImport = useCallback(async () => {
    if (!beginOperation()) return;
    try {
      if (!(await confirmImport())) return;
      const result = await backup.chooseImportFile();
      if (result.canceled) {
        setFeedback({ text: '已取消导入', kind: 'ok' });
        return;
      }
      if (!result.ok) {
        setFeedback({ text: result.error || '导入失败', kind: 'err' });
        return;
      }
      if (!result.restoreId) throw new Error('备份恢复会话缺失，请重新选择文件');

      let transaction: ReturnType<BackupStoragePort['prepareRestore']> | undefined;
      try {
        transaction = storage.prepareRestore(result.renderer || {});
        await backup.commitImport(result.restoreId);
      } catch (cause) {
        await rollbackFailedImport(backup, result.restoreId, transaction, cause);
      }
      backup.reloadAfterRestore();
    } catch (cause) {
      setFeedback({ text: errorMessage(cause), kind: 'err' });
    } finally {
      endOperation();
    }
  }, [backup, beginOperation, confirmImport, endOperation, storage]);

  const model: BackupSettingsViewModel = { busy, feedback };
  const actions: BackupSettingsActions = { onExport, onImport };
  return { model, actions };
}
