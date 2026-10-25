import { client } from '../../../api/client';
import type { BackupOperationsPort } from '../application/backupOperationsPort';

export const rendererBackupOperationsAdapter: BackupOperationsPort = {
  exportSnapshot: rendererSnapshot => client.backupExport(rendererSnapshot),
  chooseImportFile: () => client.backupImport(),
  commitImport: restoreId => client.backupCommit(restoreId),
  cancelImport: restoreId => client.backupCancel(restoreId),
  reloadAfterRestore: () => window.location.reload(),
};
