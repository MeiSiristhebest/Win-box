import { join } from 'node:path';
import { listZipEntries, looksLikeZip } from '../util/syncZip';

export interface SpiderShellCompatibilityPorts {
  readJar(path: string): Uint8Array;
  exists(path: string): boolean;
  warn(message: string): void;
  listArchiveEntries(bytes: Uint8Array): readonly string[] | null;
}

/** Resolves optional Android shell implementations without coupling JVM calls to filesystem policy. */
export class SpiderShellCompatibility {
  constructor(
    private readonly jvmDir: string,
    private readonly configuredClasses: string | undefined,
    private readonly environmentClasses: string,
    private readonly ports: SpiderShellCompatibilityPorts,
  ) {}

  classesPath(): string {
    return (this.configuredClasses || '').trim() || this.environmentClasses.trim();
  }

  shimJarPath(): string {
    return join(this.jvmDir, 'stubs', 'shell-shim.jar');
  }

  resolveForJars(jarPaths: readonly string[]): string {
    for (const jarPath of jarPaths) {
      const guard = this.guardName(jarPath);
      if (!guard) continue;
      const real = this.realImplementationPath(guard);
      if (this.ports.exists(real)) return real;
      this.ports.warn(`jvm-bridge 检测到壳 jar（guard=${guard}），但无内置真实实现: ${real}`);
    }
    return '';
  }

  includeFoniImplementation(className: string, baseShim: string): string {
    if (!baseShim || !/AppSx|AppTT|AppSK/.test(className)) return baseShim;
    const foni = join(this.jvmDir, 'shell-shim', 'real', 'foni-spider.jar');
    return this.ports.exists(foni) ? `${foni};${baseShim}` : baseShim;
  }

  private realImplementationPath(guard: string): string {
    return join(this.jvmDir, 'shell-shim', 'real', `${guard}.jar`);
  }

  private guardName(jarPath: string): string | null {
    try {
      const bytes = this.ports.readJar(jarPath);
      const entries = this.ports.listArchiveEntries(bytes);
      if (!entries) return null;
      for (const name of entries) {
        const match = /^assets\/([^/]+)\.guard$/i.exec(name);
        if (match) return match[1];
      }
    } catch {
      // An unreadable or non-ZIP jar is not a recognized shell archive.
    }
    return null;
  }
}

export function createSpiderShellCompatibilityPorts(
  readJar: (path: string) => Uint8Array,
  exists: (path: string) => boolean,
  warn: (message: string) => void,
): SpiderShellCompatibilityPorts {
  return {
    readJar,
    exists,
    warn,
    listArchiveEntries: (bytes) => {
      const archive = Buffer.from(bytes);
      return looksLikeZip(archive) ? listZipEntries(archive) : null;
    },
  };
}
