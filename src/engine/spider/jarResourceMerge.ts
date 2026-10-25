import type { ZipEntryData } from '../util/syncZip';

export interface JarResourceMergeResult {
  entries: ZipEntryData[];
  addedResourceCount: number;
}

/**
 * Purely merges resources omitted by dex2jar into its output.
 * Raw DEX files are excluded because the JVM cannot load them, while ordinary
 * assets and parent directory entries remain available through the classloader.
 */
export function mergeJarResourceEntries(
  convertedEntries: readonly ZipEntryData[],
  rawEntries: readonly ZipEntryData[],
): JarResourceMergeResult {
  const convertedNames = new Set(convertedEntries.map((entry) => entry.name));
  const carried = rawEntries.filter((entry) =>
    !/\.dex$/i.test(entry.name) && !convertedNames.has(entry.name));
  if (carried.length === 0) {
    return { entries: [...convertedEntries], addedResourceCount: 0 };
  }

  const carriedNames = new Set(carried.map((entry) => entry.name));
  const directories: ZipEntryData[] = [];
  const seenDirectories = new Set<string>();
  for (const entry of carried) {
    const parts = entry.name.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const directory = `${parts.slice(0, index).join('/')}/`;
      if (!convertedNames.has(directory) && !carriedNames.has(directory) && !seenDirectories.has(directory)) {
        seenDirectories.add(directory);
        directories.push({ name: directory, bytes: Buffer.alloc(0) });
      }
    }
  }

  return {
    entries: [...convertedEntries, ...directories, ...carried],
    addedResourceCount: carried.length,
  };
}
