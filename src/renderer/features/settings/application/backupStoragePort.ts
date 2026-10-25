export interface BackupStoragePort {
  collectSnapshot(): Record<string, string>;
  prepareRestore(snapshot: Record<string, string>): { rollback(): void };
}
