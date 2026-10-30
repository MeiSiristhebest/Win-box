import type { SourceBean } from './types';

export const MAX_SOURCE_CONFIGURATION_BATCH_SIZE = 1000;
export const MAX_SOURCE_CONFIGURATION_SIGNATURE_LENGTH = 8_000_000;

/**
 * Create a deterministic signature for the configured source list.
 * Sorting object keys keeps the signature stable across renderer/main-process clones;
 * serializing every field invalidates audits when any source setting changes.
 */
export function sourceConfigurationSignature(sources: readonly SourceBean[]): string {
  return JSON.stringify(sources, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  }) ?? '[]';
}
