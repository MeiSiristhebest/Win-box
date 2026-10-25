import type { BackupStoragePort } from '../application/backupStoragePort';
import { prepareRendererBackupRestore, STORAGE_EPOCH_KEY } from '../../../lib/storageEpoch';

export const browserBackupStorageAdapter: BackupStoragePort = {
  collectSnapshot() {
    const snapshot: Record<string, string> = {};
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key || key === STORAGE_EPOCH_KEY) continue;
        const value = localStorage.getItem(key);
        if (typeof value === 'string') snapshot[key] = value;
      }
    } catch {
      // Back up main-process settings when renderer storage is unavailable.
    }
    return snapshot;
  },
  prepareRestore(snapshot) {
    return prepareRendererBackupRestore(snapshot);
  },
};
