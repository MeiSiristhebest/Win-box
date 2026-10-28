import { rename, rm, stat } from 'node:fs/promises';
import { promoteStagedApp } from './package-app-promotion.mjs';

const CLEANUP_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 250 };

export async function withPackageStaging(stagingDir, operation, remove = rm) {
  let operationError;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await remove(stagingDir, CLEANUP_OPTIONS);
    } catch (cleanupError) {
      if (operationError) {
        throw new AggregateError([operationError, cleanupError], `Package staging failed and could not be fully cleaned: ${stagingDir}`, {
          cause: operationError,
        });
      }
      throw cleanupError;
    }
  }
}

export async function promotePackageDirectory({
  source,
  destination,
  backupPath,
  promote = (from, to) => promoteStagedApp({ source: from, destination: to }),
}) {
  let hadPrevious = false;
  try {
    await stat(destination);
    hadPrevious = true;
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }

  if (hadPrevious) {
    if (!backupPath) throw new Error('A backup path is required before replacing an existing packaged app.');
    let backupExists = true;
    try {
      await stat(backupPath);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') backupExists = false;
      else throw error;
    }
    if (backupExists) throw new Error(`Refusing to replace an existing package backup: ${backupPath}`);
    await rename(destination, backupPath);
  }

  let promotionMethod;
  try {
    promotionMethod = await promote(source, destination);
  } catch (promotionError) {
    try {
      await rm(destination, CLEANUP_OPTIONS);
      if (hadPrevious) await rename(backupPath, destination);
    } catch (rollbackError) {
      if (hadPrevious) {
        throw new AggregateError(
          [promotionError, rollbackError],
          `Package promotion failed and the previous app could not be restored; its backup remains at ${backupPath}.`,
          { cause: promotionError },
        );
      }
      throw new AggregateError([promotionError, rollbackError], 'Package promotion failed and its partial output could not be removed.', {
        cause: promotionError,
      });
    }
    throw promotionError;
  }

  if (hadPrevious) {
    try {
      await rm(backupPath, CLEANUP_OPTIONS);
    } catch (cleanupError) {
      throw new Error(`New package promoted, but the previous package backup could not be removed: ${backupPath}`, {
        cause: cleanupError,
      });
    }
  }
  return promotionMethod;
}
