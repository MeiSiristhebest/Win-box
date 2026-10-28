import { describe, expect, it, vi } from 'vitest';
import { ensureConvertedJarCacheVersion, type ConvertedJarCacheVersionPorts } from '../src/engine/spider/convertedJarCacheVersion';

function makeCache(initial: Record<string, string> = {}, directoryExists = true) {
  const files = new Map(Object.entries(initial));
  let exists = directoryExists;
  const ports: ConvertedJarCacheVersionPorts = {
    exists: vi.fn((path: string) => path === '/cache' ? exists : files.has(path.slice('/cache/'.length))),
    createDirectory: vi.fn(() => { exists = true; }),
    readText: vi.fn((path: string) => files.get(path.slice('/cache/'.length)) ?? ''),
    writeText: vi.fn((path: string, contents: string) => { files.set(path.slice('/cache/'.length), contents); }),
    listEntries: vi.fn(() => [...files.keys()]),
    removeFile: vi.fn((_directory: string, name: string) => { files.delete(name); }),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return { files, ports };
}

describe('ensureConvertedJarCacheVersion', () => {
  it('creates a missing cache directory and writes the current stamp', () => {
    const { files, ports } = makeCache({}, false);

    ensureConvertedJarCacheVersion('/cache', '/cache/.converted-version', 5, ports);

    expect(ports.createDirectory).toHaveBeenCalledWith('/cache');
    expect(files.get('.converted-version')).toBe('5');
    expect(ports.listEntries).not.toHaveBeenCalled();
  });

  it('fills in a missing stamp without discarding converted jars', () => {
    const { files, ports } = makeCache({ 'source.jar': 'valid', 'source.raw.jar': 'download' });

    ensureConvertedJarCacheVersion('/cache', '/cache/.converted-version', 5, ports);

    expect(files.get('.converted-version')).toBe('5');
    expect(files.get('source.jar')).toBe('valid');
    expect(files.get('source.raw.jar')).toBe('download');
    expect(ports.removeFile).not.toHaveBeenCalled();
  });

  it('does nothing when the stamp already matches', () => {
    const { files, ports } = makeCache({ '.converted-version': '5', 'source.jar': 'valid' });

    ensureConvertedJarCacheVersion('/cache', '/cache/.converted-version', 5, ports);

    expect(files.get('source.jar')).toBe('valid');
    expect(ports.writeText).not.toHaveBeenCalled();
    expect(ports.listEntries).not.toHaveBeenCalled();
  });

  it('invalidates jar files and preserves unrelated entries for an older stamped format', () => {
    const { files, ports } = makeCache({
      '.converted-version': '4',
      'source.jar': 'converted',
      'source.raw.jar': 'downloaded input',
      'notes.txt': 'unrelated',
    });

    ensureConvertedJarCacheVersion('/cache', '/cache/.converted-version', 5, ports);

    expect(files.get('.converted-version')).toBe('5');
    expect(files.has('source.jar')).toBe(false);
    expect(files.get('source.raw.jar')).toBeUndefined();
    expect(files.get('notes.txt')).toBe('unrelated');
    expect(ports.info).toHaveBeenCalledWith(expect.stringContaining('已作废 2 个旧产物'));
  });

  it('warns and contains migration I/O failures', () => {
    const { ports } = makeCache({ '.converted-version': '4', 'source.jar': 'converted' });
    ports.writeText = vi.fn(() => { throw new Error('disk is read-only'); });

    expect(() => ensureConvertedJarCacheVersion('/cache', '/cache/.converted-version', 5, ports)).not.toThrow();
    expect(ports.warn).toHaveBeenCalledWith(expect.stringContaining('disk is read-only'));
  });
});
