import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import releases from '@nsis/release-data/versions.json' with { type: 'json' };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NSIS_VERSION = '3.13';
const NSIS_SHA256 = 'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8';
const NSIS_CACHE = join(ROOT, '.tmp', 'tools', 'nsis', NSIS_VERSION);

function isInside(parent, path) {
  const fromParent = relative(parent, resolve(path));
  return fromParent === '' || (!fromParent.startsWith(`..${sep}`) && fromParent !== '..' && !isAbsolute(fromParent));
}

async function extractNsisArchive(archive) {
  const zip = new ZipReader(new Uint8ArrayReader(archive));
  try {
    for (const entry of await zip.getEntries()) {
      const name = entry.filename.replaceAll('\\', '/');
      const target = resolve(NSIS_CACHE, name);
      if (!isInside(NSIS_CACHE, target) || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
        throw new Error(`NSIS archive contains an unsafe path: ${entry.filename}`);
      }
      if (entry.directory) {
        await mkdir(target, { recursive: true });
      } else {
        await mkdir(dirname(target), { recursive: true });
        const data = await entry.getData(new Uint8ArrayWriter());
        await writeFile(target, data);
      }
    }
  } finally {
    await zip.close();
  }
}

async function findMakensis(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'makensis.exe') return path;
    if (entry.isDirectory()) {
      const found = await findMakensis(path);
      if (found) return found;
    }
  }
  return null;
}

export async function ensureNsis() {
  const cached = await findMakensis(NSIS_CACHE).catch(() => null);
  if (cached) return cached;

  const metadata = releases.versions?.[NSIS_VERSION]?.artifacts?.zip;
  if (!metadata || metadata.hashes?.sha256 !== NSIS_SHA256) {
    throw new Error(`NSIS ${NSIS_VERSION} download metadata does not match the pinned SHA-256 digest.`);
  }
  await mkdir(NSIS_CACHE, { recursive: true });
  const response = await fetch(metadata.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`NSIS download failed with HTTP ${response.status}.`);
  const archive = new Uint8Array(await response.arrayBuffer());
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== NSIS_SHA256) throw new Error(`NSIS archive SHA-256 mismatch: ${digest}`);
  await extractNsisArchive(archive);

  const makensis = await findMakensis(NSIS_CACHE);
  if (!makensis) throw new Error(`makensis.exe is missing from the NSIS ${NSIS_VERSION} archive.`);
  return makensis;
}

export async function compileNsis(scriptPath, { cwd, verbosity = '-V2' } = {}) {
  const makensis = await ensureNsis();
  const result = spawnSync(makensis, [verbosity, resolve(scriptPath)], {
    cwd: cwd ? resolve(cwd) : ROOT,
    encoding: 'utf8',
    timeout: 300_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`makensis exited with code ${result.status ?? 'unknown'}:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
}
