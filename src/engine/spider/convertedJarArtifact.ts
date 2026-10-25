import { existsSync, readFileSync } from 'node:fs';
import { listZipEntries, looksLikeZip } from '../util/syncZip';

export function isUsableConvertedJar(file: string): boolean {
  try {
    if (!existsSync(file)) return false;
    const contents = readFileSync(file);
    return looksLikeZip(contents) && listZipEntries(contents).some((entry) => entry.endsWith('.class'));
  } catch {
    return false;
  }
}
