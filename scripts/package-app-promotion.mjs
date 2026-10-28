import { cp, rename, rm } from 'node:fs/promises';

const PROMOTION_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_COPY_OPTIONS = { recursive: true, preserveTimestamps: true, errorOnExist: true };
const CLEANUP_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 250 };

const defaultFileSystem = {
  rename: (source, destination) => rename(source, destination),
  copy: (source, destination, options) => cp(source, destination, options),
  remove: (path, options) => rm(path, options),
};

export async function promoteStagedApp({ source, destination, platform = process.platform, fileSystem = defaultFileSystem }) {
  try {
    await fileSystem.rename(source, destination);
    return 'rename';
  } catch (renameError) {
    if (platform !== 'win32' || !PROMOTION_RENAME_ERRORS.has(renameError?.code)) {
      throw renameError;
    }

    try {
      await fileSystem.copy(source, destination, RENAME_RETRY_COPY_OPTIONS);
      return 'copy';
    } catch (copyError) {
      try {
        await fileSystem.remove(destination, CLEANUP_OPTIONS);
      } catch {
        // Keep the original copy error as the failure so callers retain its code and cause.
      }
      throw copyError;
    }
  }
}
