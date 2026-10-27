import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const MANIFEST_PATH = 'scripts/runtime-assets.json';

function isZipFile(bytes) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  const searchStart = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= searchStart; offset--) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) return true;
  }
  return false;
}

function isPeX64(bytes) {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return false;
  const headerOffset = bytes.readUInt32LE(0x3c);
  return headerOffset + 6 <= bytes.length &&
    bytes.subarray(headerOffset, headerOffset + 4).toString('ascii') === 'PE\0\0' &&
    bytes.readUInt16LE(headerOffset + 4) === 0x8664;
}

async function checkEntry(root, entry, resolveAssetPath = (path) => resolve(root, path), { allowPackagedTransform = false } = {}) {
  const failures = [];
  const files = [];
  const fingerprints = [];
  let present = false;

  if (entry.kind === 'jar-directory') {
    const directory = resolveAssetPath(entry.paths[0]);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return { failures: [`${entry.paths[0]} (directory is missing)`], fingerprints, present };
    }
    present = true;
    const jars = entries.filter((item) => item.isFile() && item.name.toLowerCase().endsWith('.jar'));
    if (jars.length === 0) {
      return { failures: [`${entry.paths[0]}/*.jar (no dex2jar archives found)`], fingerprints, present };
    }
    for (const item of jars) {
      const relativePath = `${entry.paths[0]}/${item.name}`;
      files.push({ file: join(directory, item.name), relativePath });
    }
  } else {
    for (const relativePath of entry.paths) {
      const file = resolveAssetPath(relativePath);
      try {
        const info = await stat(file);
        present = true;
        if (!info.isFile() || info.size === 0) {
          failures.push(`${relativePath} (not a non-empty file)`);
          continue;
        }
        files.push({ file, relativePath });
      } catch {
        failures.push(`${relativePath} (missing)`);
      }
    }
  }

  for (const { file, relativePath } of files) {
    const bytes = await readFile(file);
    if ((entry.kind === 'jar' || entry.kind === 'jar-directory') && !isZipFile(bytes)) {
      failures.push(`${relativePath} (not a valid JAR/ZIP file)`);
      continue;
    }
    if (entry.kind === 'pe-x64' && !isPeX64(bytes)) {
      failures.push(`${relativePath} (not a Windows x64 executable)`);
      continue;
    }
    if (entry.sha256) {
      const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
      if (actual !== entry.sha256.toUpperCase() && !(allowPackagedTransform && entry.packagedTransform)) {
        failures.push(`${relativePath} (SHA-256 mismatch; expected ${entry.sha256}, got ${actual})`);
      } else if (allowPackagedTransform && entry.packagedTransform) {
        fingerprints.push({
          id: entry.id,
          path: relativePath,
          sha256: actual,
          transformation: entry.packagedTransform,
        });
      }
    } else if (entry.sha256Policy === 'calculate-at-package-time') {
      fingerprints.push({
        id: entry.id,
        path: relativePath,
        sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      });
    }
  }
  return { failures, fingerprints, present };
}

function missingMetadata(entry) {
  const missing = [];
  if (!entry.version) missing.push('version');
  if (!entry.source) missing.push('source');
  if (!entry.architecture) missing.push('architecture');
  if (!entry.sha256 && !entry.archiveSha256 && entry.sha256Policy !== 'calculate-at-package-time') {
    missing.push('SHA-256');
  }
  return missing;
}

function metadataFailures(entry) {
  const missing = missingMetadata(entry);
  return missing.length ? [`${entry.id}: missing ${missing.join(', ')} pin(s)`] : [];
}

export async function inspectReleaseAssets(root, { phase = 'complete', manifest } = {}) {
  const releaseRoot = resolve(root);
  const assetManifest = manifest ?? JSON.parse(await readFile(join(releaseRoot, MANIFEST_PATH), 'utf8'));
  const errors = [];
  const warnings = [];
  const fingerprints = [];
  const required = assetManifest.required.filter((entry) =>
    phase === 'pre-build' ? entry.phase === 'pre-build' : true,
  );

  for (const entry of required) {
    errors.push(...metadataFailures(entry));
    const result = await checkEntry(releaseRoot, entry);
    errors.push(...result.failures);
    fingerprints.push(...result.fingerprints);
  }

  for (const entry of assetManifest.optional ?? []) {
    const result = await checkEntry(releaseRoot, entry);
    fingerprints.push(...result.fingerprints);
    if (result.present) {
      errors.push(...metadataFailures(entry), ...result.failures);
      continue;
    }

    if (result.failures.length) warnings.push(`${entry.id}: ${result.failures.join('; ')}`);
    const missing = missingMetadata(entry).filter((item) => item !== 'SHA-256');
    if (missing.length) warnings.push(`${entry.id}: missing ${missing.join(', ')} pin(s)`);
    if (!entry.sha256 && entry.sha256Policy !== 'calculate-at-package-time') {
      warnings.push(`${entry.id}: SHA-256 is not pinned`);
    }
  }

  return { errors, warnings, fingerprints };
}

export async function assertReleaseAssets(root, options) {
  const { errors, warnings, fingerprints } = await inspectReleaseAssets(root, options);
  if (warnings.length) {
    console.warn(`[release assets] Optional or unpinned assets:\n${warnings.map((item) => `- ${item}`).join('\n')}`);
  }
  if (errors.length) {
    throw new Error(`Release asset preflight failed:\n${errors.map((item) => `- ${item}`).join('\n')}`);
  }
  console.log('[release assets] Required runtime assets passed preflight.');
  for (const item of fingerprints) console.log(`[release assets] SHA-256 ${item.id} ${item.path}: ${item.sha256}`);
  return { errors, warnings, fingerprints };
}

export async function assertPackagedReleaseAssets(stagingDirectory, { manifest } = {}) {
  if (!manifest?.required) throw new Error('Packaged runtime asset verification requires the runtime asset manifest.');
  const packageRoot = resolve(stagingDirectory);
  const unpackedRoot = resolve(packageRoot, 'resources', 'app.asar.unpacked');
  const resolvePackagedPath = (assetPath) => {
    const normalized = String(assetPath).replaceAll('\\', '/').replace(/^\/+/, '');
    if (!normalized.startsWith('resources/') || normalized.split('/').includes('..')) {
      throw new Error(`Packaged runtime asset path must be inside resources/: ${assetPath}`);
    }
    return resolve(unpackedRoot, normalized);
  };
  const errors = [];
  const fingerprints = [];
  for (const entry of manifest.required) {
    errors.push(...metadataFailures(entry));
    const result = await checkEntry(packageRoot, entry, resolvePackagedPath, { allowPackagedTransform: true });
    errors.push(...result.failures);
    fingerprints.push(...result.fingerprints);
  }
  if (errors.length) {
    throw new Error(`Packaged runtime asset verification failed:\n${errors.map((item) => `- ${item}`).join('\n')}`);
  }
  return { errors, fingerprints };
}
