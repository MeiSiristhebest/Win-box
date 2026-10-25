import { describe, expect, it, vi } from 'vitest';
import { JarClasspathResolver, type JarClasspathFileSystemPort } from '../src/engine/spider/JarClasspathResolver';
import { buildZip } from '../src/engine/util/syncZip';

function createFileSystem(files: Record<string, Buffer>) {
  const directory = 'cache';
  const stats = new Map(Object.keys(files).map((name) => [`${directory}\\${name}`, { size: files[name].length, mtimeMs: 1 }]));
  const fileSystem: JarClasspathFileSystemPort = {
    list: vi.fn(() => Object.keys(files)),
    read: vi.fn((path) => files[path.slice(directory.length + 1)]),
    stat: vi.fn((path) => {
      const stat = stats.get(path);
      if (!stat) throw new Error(`File missing: ${path}`);
      return stat;
    }),
  };
  return { fileSystem, stats, directory };
}

function archive(entry: string, content = 'same') {
  return buildZip([{ name: entry, bytes: Buffer.from(content) }]);
}

describe('JarClasspathResolver', () => {
  const entry = 'com/github/catvod/spider/Target.class';

  it('excludes declared, raw and in-progress jars, and de-duplicates identical builds', () => {
    const { fileSystem, directory } = createFileSystem({
      'declared.jar': archive('fixture/Helper.class'),
      'target.jar': archive(entry),
      'target-copy.jar': archive(entry),
      'target.raw.jar': archive(entry, 'raw'),
      'target.part.jar': archive(entry, 'part'),
      'unrelated.jar': archive('com/github/catvod/spider/Other.class'),
    });
    const resolver = new JarClasspathResolver(directory, fileSystem);

    expect(resolver.uniqueCandidates([`${directory}\\declared.jar`], entry)).toEqual([`${directory}\\target.jar`]);
  });

  it('invalidates a remembered fallback when the cached artifact is replaced', () => {
    const target = archive(entry, 'first build');
    const { fileSystem, stats, directory } = createFileSystem({ 'target.jar': target, 'declared.jar': archive('fixture/Helper.class') });
    const resolver = new JarClasspathResolver(directory, fileSystem);
    const bindingKey = `declared\n${entry}`;
    resolver.remember(bindingKey, `${directory}\\target.jar`);

    expect(resolver.rememberedCandidate(bindingKey, [`${directory}\\declared.jar`], entry)).toBe(`${directory}\\target.jar`);
    fileSystem.read = vi.fn((path) => path.endsWith('target.jar') ? archive(entry, 'replacement build') : archive('fixture/Helper.class'));
    stats.set(`${directory}\\target.jar`, { size: 99_999, mtimeMs: 2 });

    expect(resolver.rememberedCandidate(bindingKey, [`${directory}\\declared.jar`], entry)).toBeNull();
  });

  it('drops a remembered fallback once the declared jar gains the entry class', () => {
    const { fileSystem, stats, directory } = createFileSystem({
      'declared.jar': archive('fixture/Helper.class'),
      'target.jar': archive(entry),
    });
    const resolver = new JarClasspathResolver(directory, fileSystem);
    const bindingKey = `declared\n${entry}`;
    resolver.remember(bindingKey, `${directory}\\target.jar`);
    fileSystem.read = vi.fn((path) => archive(path.endsWith('declared.jar') ? entry : entry));
    stats.set(`${directory}\\declared.jar`, { size: 99_999, mtimeMs: 2 });

    expect(resolver.rememberedCandidate(bindingKey, [`${directory}\\declared.jar`], entry)).toBeNull();
  });
});
