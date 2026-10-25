import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contentHashOf } from './jarContentIndex';
import { listZipEntries } from '../util/syncZip';

export interface JarClasspathFileSystemPort {
  list(directory: string): string[];
  read(path: string): Buffer;
  stat(path: string): { size: number; mtimeMs: number };
}

interface JarClassIndex {
  stamp: string;
  entries: ReadonlySet<string>;
  contentHash: string;
}

interface FallbackBinding {
  path: string;
  contentHash: string;
}

const nodeFileSystem: JarClasspathFileSystemPort = {
  list: (directory) => readdirSync(directory),
  read: (path) => readFileSync(path),
  stat: (path) => {
    const { size, mtimeMs } = statSync(path);
    return { size, mtimeMs };
  },
};

/** Resolves a missing spider entry class without mixing unrelated subscription JARs. */
export class JarClasspathResolver {
  private readonly indexes = new Map<string, JarClassIndex>();
  private readonly fallbackBindings = new Map<string, FallbackBinding>();

  constructor(
    private readonly cacheDirectory: string,
    private readonly fileSystem: JarClasspathFileSystemPort = nodeFileSystem,
    private readonly maxIndexes = 64,
  ) {}

  rememberedCandidate(bindingKey: string, declaredJars: readonly string[], entryClass: string): string | null {
    const binding = this.fallbackBindings.get(bindingKey);
    if (!binding) return null;
    const candidateIndex = this.classIndex(binding.path);
    if (candidateIndex?.contentHash === binding.contentHash && !this.containsClass(declaredJars, entryClass)) {
      return binding.path;
    }
    this.fallbackBindings.delete(bindingKey);
    return null;
  }

  containsClass(jars: readonly string[], entryClass: string): boolean {
    return jars.some((path) => this.classIndex(path)?.entries.has(entryClass));
  }

  uniqueCandidates(declaredJars: readonly string[], entryClass: string): string[] {
    const excluded = new Set(declaredJars.map((path) => path.toLowerCase()));
    const byContent = new Map<string, string>();
    try {
      for (const fileName of this.fileSystem.list(this.cacheDirectory)) {
        // Raw dex archives and in-progress conversion artifacts are never valid classpath candidates.
        if (!fileName.endsWith('.jar') || fileName.endsWith('.raw.jar') || fileName.endsWith('.part.jar')) continue;
        const path = join(this.cacheDirectory, fileName);
        if (excluded.has(path.toLowerCase())) continue;
        const index = this.classIndex(path);
        if (index?.entries.has(entryClass) && !byContent.has(index.contentHash)) {
          byContent.set(index.contentHash, path);
        }
      }
    } catch {
      // A missing cache directory simply means there are no fallback candidates.
    }
    return [...byContent.values()];
  }

  remember(bindingKey: string, path: string): void {
    const index = this.classIndex(path);
    if (index) this.fallbackBindings.set(bindingKey, { path, contentHash: index.contentHash });
  }

  private classIndex(path: string): JarClassIndex | null {
    try {
      const stat = this.fileSystem.stat(path);
      const stamp = `${stat.size}:${stat.mtimeMs}`;
      const cached = this.indexes.get(path);
      if (cached?.stamp === stamp) return cached;
      const content = this.fileSystem.read(path);
      const index = {
        stamp,
        entries: new Set(listZipEntries(content)),
        contentHash: contentHashOf(content),
      };
      if (this.indexes.size >= this.maxIndexes) {
        const oldestPath = this.indexes.keys().next().value;
        if (oldestPath !== undefined) this.indexes.delete(oldestPath);
      }
      this.indexes.set(path, index);
      return index;
    } catch {
      this.indexes.delete(path);
      return null;
    }
  }
}
