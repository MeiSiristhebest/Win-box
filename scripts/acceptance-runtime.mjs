import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import metadata from './playback-runtime.json' with { type: 'json' };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function inside(parent, path) { const rel = relative(parent, path); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }

/** A pinned official runtime used only in isolated acceptance sessions. */
export async function prepareMpvAcceptanceRuntime() {
  const cache = join(ROOT, '.tmp', 'tools', `mpv-${metadata.version}`);
  await mkdir(cache, { recursive: true });
  const archivePath = join(cache, metadata.filename);
  let archive = await readFile(archivePath).catch(() => null);
  const valid = bytes => bytes?.length === metadata.size && createHash('sha256').update(bytes).digest('hex') === metadata.sha256;
  if (!valid(archive)) {
    const response = await fetch(metadata.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`MPV download failed: HTTP ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
    if (!valid(archive)) throw new Error('Official MPV archive SHA-256 mismatch.');
    await writeFile(archivePath, archive);
  }
  const directory = await mkdtemp(join(ROOT, '.tmp', 'mpv-acceptance-'));
  const reader = new ZipReader(new Uint8ArrayReader(archive));
  try {
    for (const entry of await reader.getEntries()) {
      const name = entry.filename.replaceAll('\\', '/');
      const path = resolve(directory, name);
      if (!inside(directory, path) || name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw new Error(`Unsafe MPV archive path: ${name}`);
      if (entry.directory) await mkdir(path, { recursive: true });
      else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, await entry.getData(new Uint8ArrayWriter())); }
    }
  } finally { await reader.close(); }
  const executables = [];
  async function find(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await find(join(path, entry.name));
      else if (entry.name.toLowerCase() === 'mpv.exe') executables.push(join(path, entry.name));
    }
  }
  await find(directory);
  if (executables.length !== 1 || !(await stat(executables[0])).isFile()) throw new Error('MPV acceptance runtime is ambiguous or missing.');
  return { path: executables[0], directory, version: metadata.version, source: metadata.source, archiveSha256: metadata.sha256, executableSha256: createHash('sha256').update(await readFile(executables[0])).digest('hex') };
}
