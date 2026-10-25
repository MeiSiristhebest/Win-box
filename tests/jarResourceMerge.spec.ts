import { describe, expect, it } from 'vitest';
import { mergeJarResourceEntries } from '../src/engine/spider/jarResourceMerge';

describe('mergeJarResourceEntries', () => {
  it('keeps converted entries, copies non-dex resources, and creates each missing parent directory once', () => {
    const converted = [
      { name: 'com/example/Spider.class', bytes: Buffer.from('class') },
      { name: 'assets/shared.bin', bytes: Buffer.from('newer') },
    ];
    const raw = [
      { name: 'classes.dex', bytes: Buffer.from('dex') },
      { name: 'assets/shared.bin', bytes: Buffer.from('older') },
      { name: 'assets/guard/key.bin', bytes: Buffer.from('key') },
      { name: 'assets/guard/cert.bin', bytes: Buffer.from('cert') },
    ];

    const result = mergeJarResourceEntries(converted, raw);

    expect(result.addedResourceCount).toBe(2);
    expect(result.entries.map((entry) => entry.name)).toEqual([
      'com/example/Spider.class',
      'assets/shared.bin',
      'assets/',
      'assets/guard/',
      'assets/guard/key.bin',
      'assets/guard/cert.bin',
    ]);
    expect(result.entries.find((entry) => entry.name === 'assets/shared.bin')?.bytes.toString()).toBe('newer');
    expect(result.entries.find((entry) => entry.name === 'assets/guard/')?.bytes).toHaveLength(0);
    expect(converted.map((entry) => entry.name)).toEqual(['com/example/Spider.class', 'assets/shared.bin']);
  });

  it('does not create a new archive when all raw entries are dex or already converted', () => {
    const converted = [{ name: 'com/example/Spider.class', bytes: Buffer.from('class') }];
    const result = mergeJarResourceEntries(converted, [
      { name: 'classes.dex', bytes: Buffer.from('dex') },
      { name: 'com/example/Spider.class', bytes: Buffer.from('older class') },
    ]);

    expect(result.addedResourceCount).toBe(0);
    expect(result.entries).toEqual(converted);
    expect(result.entries).not.toBe(converted);
  });
});
