import { existsSync, readFileSync } from 'node:fs';
import { listZipEntries, looksLikeZip } from '../util/syncZip';

export interface ConvertedJarArtifactInspectorPorts {
  fingerprint(file: string): string;
  isUsable(file: string): boolean;
}

/** Caches artifact validation only while the file's observable fingerprint is stable. */
export class ConvertedJarArtifactInspector {
  private readonly usableFingerprints = new Map<string, string>();

  constructor(private readonly ports: ConvertedJarArtifactInspectorPorts) {}

  isUsable(file: string): boolean {
    try {
      const fingerprint = this.ports.fingerprint(file);
      if (this.usableFingerprints.get(file) === fingerprint) return true;

      if (!this.ports.isUsable(file)) {
        this.usableFingerprints.delete(file);
        return false;
      }
      this.usableFingerprints.set(file, fingerprint);
      return true;
    } catch {
      this.usableFingerprints.delete(file);
      return false;
    }
  }
}

export function isUsableConvertedJar(file: string): boolean {
  try {
    if (!existsSync(file)) return false;
    const contents = readFileSync(file);
    return looksLikeZip(contents) && listZipEntries(contents).some((entry) => entry.endsWith('.class'));
  } catch {
    return false;
  }
}
