import type { AuditItem, SourceBean } from '../../../../shared/types';
import { MAX_SOURCE_CONFIGURATION_BATCH_SIZE, sourceConfigurationSignature } from '../../../../shared/sourceConfigurationSignature';

export interface SourceHealthAuditPort {
  run(profileId: string): Promise<AuditItem[]>;
  deleteSources(sourceKeys: readonly string[], expectedProfileId: string, expectedSourceSignature: string): Promise<string[]>;
  announceSourcesChanged(): void;
}

export class PartialFailedSourceCleanupError extends Error {
  constructor(readonly deletedKeys: readonly string[], cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`已删除 ${deletedKeys.length} 个请求失败线路；后续清理已中止，请刷新后重新体检。${reason}`);
    this.name = 'PartialFailedSourceCleanupError';
  }
}

export type FailedSourceCleanupResult =
  | { kind: 'no-failed-sources' }
  | { kind: 'nothing-removed'; failedCount: number }
  | { kind: 'all-removed'; deletedCount: number }
  | { kind: 'removed'; deletedCount: number; remainingCount: number };

export async function removeFailedSources(
  audit: readonly AuditItem[],
  sources: readonly SourceBean[],
  expectedProfileId: string,
  port: SourceHealthAuditPort,
): Promise<FailedSourceCleanupResult> {
  const currentKeys = new Set(sources.map((source) => source.key));
  const failedKeys = [...new Set(audit.filter((item) => item.health === 'error' && currentKeys.has(item.key)).map((item) => item.key))];
  if (failedKeys.length === 0) return { kind: 'no-failed-sources' };

  const deletedKeys = new Set<string>();
  let currentSources = [...sources];
  let expectedSourceSignature = sourceConfigurationSignature(currentSources);
  try {
    for (let offset = 0; offset < failedKeys.length; offset += MAX_SOURCE_CONFIGURATION_BATCH_SIZE) {
      const batch = failedKeys.slice(offset, offset + MAX_SOURCE_CONFIGURATION_BATCH_SIZE);
      const requested = new Set(batch);
      const removed = await port.deleteSources(batch, expectedProfileId, expectedSourceSignature);
      const removedThisBatch = new Set(removed.filter((key) => requested.has(key)));
      for (const key of removedThisBatch) deletedKeys.add(key);
      currentSources = currentSources.filter((source) => !removedThisBatch.has(source.key));
      expectedSourceSignature = sourceConfigurationSignature(currentSources);
    }
  } catch (error) {
    if (deletedKeys.size > 0) {
      throw new PartialFailedSourceCleanupError([...deletedKeys], error);
    }
    throw error;
  }
  const deletedCount = failedKeys.filter((key) => deletedKeys.has(key)).length;
  if (deletedCount === 0) return { kind: 'nothing-removed', failedCount: failedKeys.length };

  const remainingCount = sources.filter((source) => !deletedKeys.has(source.key)).length;
  if (remainingCount === 0) {
    return { kind: 'all-removed', deletedCount };
  }
  return { kind: 'removed', deletedCount, remainingCount };
}
