import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  assertNoReparsePointPrefix,
  enforceMediaRuntimeExpansionBudget,
  enforceMediaRuntimeExpansionBudgetAsync,
  resolveContainedRealPath,
  type AsyncRuntimeTreeFilesystemPort,
  type RuntimePathInfo,
  type RuntimeTreeEntry,
  type RuntimeTreeFilesystemPort,
} from '../src/main/player/mediaRuntimePathSafety';

function pathInfo(kind: 'directory' | 'file' | 'link', size = 0): RuntimePathInfo {
  return {
    isSymbolicLink: () => kind === 'link',
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    size,
  };
}

class FakeFilesystem implements RuntimeTreeFilesystemPort {
  readonly infos = new Map<string, RuntimePathInfo>();
  readonly canonicalPaths = new Map<string, string>();
  readonly children = new Map<string, RuntimeTreeEntry[]>();

  lstat(path: string): RuntimePathInfo {
    const result = this.infos.get(resolve(path));
    if (result) return result;
    throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
  }

  realpath(path: string): string {
    const key = resolve(path);
    const canonical = this.canonicalPaths.get(key);
    if (canonical) return resolve(canonical);
    this.lstat(key);
    return key;
  }

  readdir(path: string): RuntimeTreeEntry[] {
    const result = this.children.get(resolve(path));
    if (result) return result;
    throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
  }

  directory(path: string, entries: string[] = []): void {
    const key = resolve(path);
    this.infos.set(key, pathInfo('directory'));
    this.children.set(key, entries.map((name) => ({ name, isSymbolicLink: () => false })));
  }

  file(path: string, size: number): void {
    this.infos.set(resolve(path), pathInfo('file', size));
  }

  link(path: string): void {
    this.infos.set(resolve(path), pathInfo('link'));
  }
}

const fixtureRoot = join(tmpdir(), 'winbox-runtime-path-safety-fixture');

describe('media runtime canonical path safety', () => {
  it('rejects symlink or junction components before writes or recursive deletion', () => {
    const fs = new FakeFilesystem();
    const appRoot = join(fixtureRoot, 'app-data');
    const linkedVersions = join(appRoot, 'media-runtimes', 'mpv', 'versions');
    fs.directory(appRoot);
    fs.directory(join(appRoot, 'media-runtimes'));
    fs.directory(join(appRoot, 'media-runtimes', 'mpv'));
    fs.link(linkedVersions);

    expect(() => assertNoReparsePointPrefix(appRoot, join(linkedVersions, 'old-version'), fs))
      .toThrow(/符号链接|reparse point/);
    expect(() => resolveContainedRealPath(appRoot, linkedVersions, fs))
      .toThrow(/符号链接|reparse point/);
  });

  it('rejects an existing path whose canonical target escapes the trusted root', () => {
    const fs = new FakeFilesystem();
    const appRoot = join(fixtureRoot, 'app-data-canonical');
    const versionRoot = join(appRoot, 'media-runtimes', 'mpv', 'versions', 'v1');
    const executable = join(versionRoot, 'mpv.exe');
    fs.directory(appRoot);
    fs.directory(join(appRoot, 'media-runtimes'));
    fs.directory(join(appRoot, 'media-runtimes', 'mpv'));
    fs.directory(join(appRoot, 'media-runtimes', 'mpv', 'versions'));
    fs.directory(versionRoot);
    fs.file(executable, 5);
    fs.canonicalPaths.set(resolve(executable), join(fixtureRoot, 'outside', 'mpv.exe'));

    expect(() => resolveContainedRealPath(appRoot, executable, fs)).toThrow(/越出应用数据目录/);
  });

  it('enforces expanded file count, byte size, and depth budgets', () => {
    const root = join(fixtureRoot, 'expanded');
    const fs = new FakeFilesystem();
    fs.directory(root, ['one.bin', 'two.bin']);
    fs.file(join(root, 'one.bin'), 2);
    fs.file(join(root, 'two.bin'), 2);

    expect(() => enforceMediaRuntimeExpansionBudget(root, fs, undefined, { maxEntries: 1, maxBytes: 10, maxDepth: 3 }))
      .toThrow(/条目超过/);
    expect(() => enforceMediaRuntimeExpansionBudget(root, fs, undefined, { maxEntries: 3, maxBytes: 3, maxDepth: 3 }))
      .toThrow(/总大小超过/);

    const deepRoot = join(fixtureRoot, 'expanded-deep');
    const deepFs = new FakeFilesystem();
    deepFs.directory(deepRoot, ['a']);
    deepFs.directory(join(deepRoot, 'a'), ['b']);
    deepFs.directory(join(deepRoot, 'a', 'b'));
    expect(() => enforceMediaRuntimeExpansionBudget(deepRoot, deepFs, undefined, { maxEntries: 10, maxBytes: 10, maxDepth: 1 }))
      .toThrow(/深度超过/);
  });

  it('applies the same expansion limits through asynchronous filesystem operations', async () => {
    const root = join(fixtureRoot, 'expanded-async');
    const fs = new FakeFilesystem();
    fs.directory(root, ['one.bin', 'two.bin']);
    fs.file(join(root, 'one.bin'), 2);
    fs.file(join(root, 'two.bin'), 2);
    const asyncFs: AsyncRuntimeTreeFilesystemPort = {
      lstat: async (path) => fs.lstat(path),
      realpath: async (path) => fs.realpath(path),
      readdir: async (path) => fs.readdir(path),
    };

    await expect(enforceMediaRuntimeExpansionBudgetAsync(root, asyncFs, undefined, {
      maxEntries: 1, maxBytes: 10, maxDepth: 3,
    })).rejects.toThrow(/条目超过/);
    await expect(enforceMediaRuntimeExpansionBudgetAsync(root, asyncFs, undefined, {
      maxEntries: 3, maxBytes: 3, maxDepth: 3,
    })).rejects.toThrow(/总大小超过/);
  });

  it('rejects archive symlinks and a symlinked extraction root', () => {
    const root = join(fixtureRoot, 'expanded-links');
    const fs = new FakeFilesystem();
    fs.directory(root, ['payload']);
    fs.link(join(root, 'payload'));
    expect(() => enforceMediaRuntimeExpansionBudget(root, fs)).toThrow(/符号链接|reparse point/);

    const linkedRoot = join(fixtureRoot, 'linked-expanded-root');
    fs.link(linkedRoot);
    expect(() => enforceMediaRuntimeExpansionBudget(linkedRoot, fs)).toThrow(/符号链接|reparse point/);
  });
});
