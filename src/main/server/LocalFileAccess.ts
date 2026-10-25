import { existsSync, statSync } from 'node:fs';
import { localFilePathCandidates } from './localFilePathPolicy';

/** Filesystem adapter for the pure local-path confinement policy. */
export function resolveLocalFilePath(rel: string, roots: readonly string[]): string | null {
  for (const candidate of localFilePathCandidates(rel, roots)) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // A permission failure or a race falls through to the next approved root.
    }
  }
  return null;
}
