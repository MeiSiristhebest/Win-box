import type { BackupExportResult, BackupImportResult } from '../../../../shared/backup';

export interface BackupOperationsPort {
  exportSnapshot(rendererSnapshot: Record<string, string>): Promise<BackupExportResult>;
  chooseImportFile(): Promise<BackupImportResult>;
  commitImport(restoreId: string): Promise<void>;
  cancelImport(restoreId: string): Promise<void>;
  reloadAfterRestore(): void;
}
