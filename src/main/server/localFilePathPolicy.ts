import { join, normalize, sep } from 'node:path';

/** Pure lexical path policy. Filesystem existence and file-type checks belong to LocalFileAccess. */
export function localFilePathCandidates(rel: string, roots: readonly string[]): string[] {
  const clean = (rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('\0')) return [];

  const candidates: string[] = [];
  for (const root of roots) {
    const absolute = normalize(join(root, clean));
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (absolute.startsWith(prefix)) candidates.push(absolute);
  }
  return candidates;
}
