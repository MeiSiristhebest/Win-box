import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateMediaRuntimeArchiveListing,
} from '../src/main/player/mediaRuntimeArchivePreflight';

function listing(...records: string[]): string {
  return `Listing archive: runtime.zip\n\n----------\n${records.join('\n\n')}\n`;
}

function file(path: string, size: number, extra = ''): string {
  return [`Path = ${path}`, `Size = ${size}`, 'Packed Size = 1', extra].filter(Boolean).join('\n');
}

function directory(path: string): string {
  return [`Path = ${path}`, 'Folder = +', 'Attributes = D'].join('\n');
}

interface SevenZipProbe {
  FS: {
    mkdir(path: string): unknown;
    mount(type: unknown, options: { root: string }, mountPoint: string): unknown;
    unmount(mountPoint: string): void;
    cwd(): string;
    chdir(path: string): void;
  };
  NODEFS: unknown;
  callMain(args: string[]): void;
}

type SevenZipFactory = (options: { print(line: string): void; printErr(line: string): void }) => Promise<SevenZipProbe>;

describe('validateMediaRuntimeArchiveListing', () => {
  it('counts entries and cumulative uncompressed bytes without extracting', () => {
    expect(validateMediaRuntimeArchiveListing(listing(directory('runtime'), file('runtime/bin/mpv.exe', 3), file('runtime/license.txt', 2))))
      .toEqual({ entries: 3, bytes: 5 });
  });

  it('parses the actual technical listing emitted by the installed 7z-wasm engine', async () => {
    const require = createRequire(import.meta.url);
    const imported = require('7z-wasm') as SevenZipFactory | { default: SevenZipFactory };
    const factory = typeof imported === 'function' ? imported : imported.default;
    const hostRoot = mkdtempSync(join(tmpdir(), 'winbox-archive-listing-test-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    let mounted = false;
    let sevenZip: SevenZipProbe | null = null;
    let previousDirectory = '/';
    try {
      mkdirSync(join(hostRoot, 'subdir'));
      writeFileSync(join(hostRoot, 'subdir', 'payload.txt'), 'hello');
      sevenZip = await factory({ print: (line) => stdout.push(line), printErr: (line) => stderr.push(line) });
      const mountPoint = '/winbox-runtime-test';
      sevenZip.FS.mkdir(mountPoint);
      sevenZip.FS.mount(sevenZip.NODEFS, { root: hostRoot }, mountPoint);
      mounted = true;
      previousDirectory = sevenZip.FS.cwd();
      sevenZip.FS.chdir(mountPoint);
      sevenZip.callMain(['a', 'fixture.7z', 'subdir']);
      stdout.length = 0;
      stderr.length = 0;
      sevenZip.callMain(['l', '-slt', '-bd', 'fixture.7z']);

      expect(stderr).toEqual([]);
      expect(validateMediaRuntimeArchiveListing(stdout.join('\n'))).toEqual({ entries: 2, bytes: 5 });
    } finally {
      if (sevenZip && mounted) {
        sevenZip.FS.chdir(previousDirectory);
        sevenZip.FS.unmount('/winbox-runtime-test');
      }
      rmSync(hostRoot, { recursive: true, force: true });
    }
  });

  it('rejects entry count, expanded byte, and path depth budget violations', () => {
    expect(() => validateMediaRuntimeArchiveListing(listing(file('one.bin', 1), file('two.bin', 1)), {
      maxEntries: 1, maxBytes: 10, maxDepth: 4,
    })).toThrow(/条目超过/);
    expect(() => validateMediaRuntimeArchiveListing(listing(file('one.bin', 6)), {
      maxEntries: 10, maxBytes: 5, maxDepth: 4,
    })).toThrow(/总大小超过/);
    expect(() => validateMediaRuntimeArchiveListing(listing(file('a/b/c/file.bin', 1)), {
      maxEntries: 10, maxBytes: 10, maxDepth: 3,
    })).toThrow(/深度超过/);
  });

  it('rejects absolute, drive, and parent traversal paths before extraction', () => {
    for (const path of ['/root/file', '\\server\\share\\file', 'C:\\Windows\\evil.exe', 'runtime/../outside.exe']) {
      expect(() => validateMediaRuntimeArchiveListing(listing(file(path, 1)))).toThrow(/绝对路径|不安全路径/);
    }
  });

  it('rejects symbolic link, hard link, and reparse entries', () => {
    expect(() => validateMediaRuntimeArchiveListing(listing(
      ['Path = runtime/link', 'Folder = -', 'Size = 0', 'Symbolic Link = ../outside'].join('\n'),
    ))).toThrow(/链接或 reparse/);
    expect(() => validateMediaRuntimeArchiveListing(listing(
      ['Path = runtime/link', 'Folder = -', 'Size = 0', 'Hard Link = runtime/file'].join('\n'),
    ))).toThrow(/链接或 reparse/);
    expect(() => validateMediaRuntimeArchiveListing(listing(file('runtime/link', 0, 'Attributes = A_ lrwxrwxrwx'))))
      .toThrow(/链接或 reparse/);
  });

  it('fails closed when the listing is missing, malformed, or has unknown entry types', () => {
    expect(() => validateMediaRuntimeArchiveListing('')).toThrow(/清单为空/);
    expect(() => validateMediaRuntimeArchiveListing('Listing archive: runtime.zip\nno technical separator')).toThrow(/无法识别/);
    expect(() => validateMediaRuntimeArchiveListing(listing('Path = runtime/file'))).toThrow(/文件大小字段无效/);
    expect(() => validateMediaRuntimeArchiveListing(listing(['Path = runtime/file', 'Folder = ?', 'Size = 0'].join('\n'))))
      .toThrow(/类型无法识别/);
  });
});
