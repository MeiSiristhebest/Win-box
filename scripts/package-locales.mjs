import { lstat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Win-Box's interface is Chinese, with English as the universal Chromium
// fallback. Keep Traditional Chinese resources for users whose system UI uses
// that locale; Chromium's other locale packs are not used by the app.
const retainedLocalePacks = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);

/** Remove unused Chromium translations from a staged Windows Electron app. */
export async function pruneUnusedChromiumLocalePacks(buildPath) {
  const localeDirectory = join(buildPath, 'locales');
  const entries = await readdir(localeDirectory, { withFileTypes: true });
  const stagedFiles = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const missing = [...retainedLocalePacks].filter((name) => !stagedFiles.has(name));
  if (missing.length) {
    throw new Error(`Windows package is missing required Chromium locales: ${missing.join(', ')}`);
  }

  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pak') || retainedLocalePacks.has(entry.name)) continue;
    const path = join(localeDirectory, entry.name);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
    await unlink(path);
    removed.push({ name: entry.name, bytes: metadata.size });
  }

  return {
    retained: [...retainedLocalePacks],
    removed,
    bytesSaved: removed.reduce((sum, file) => sum + file.bytes, 0),
  };
}
