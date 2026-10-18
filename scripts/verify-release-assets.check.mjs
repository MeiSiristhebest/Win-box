import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectReleaseAssets } from './verify-release-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = join(root, '.tmp');
let fixtureRoot;

before(async () => {
  await mkdir(tempRoot, { recursive: true });
  fixtureRoot = await mkdtemp(join(tempRoot, 'release-assets-check-'));
});

after(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function makePe(machine = 0x8664) {
  const bytes = Buffer.alloc(0x80);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  bytes.writeUInt32LE(0x40, 0x3c);
  Buffer.from([0x50, 0x45, 0, 0]).copy(bytes, 0x40);
  bytes.writeUInt16LE(machine, 0x44);
  return bytes;
}

function makeZip() {
  const name = Buffer.from('x');
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

async function writeFixture(relativePath, bytes) {
  const file = join(fixtureRoot, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

function entry(id, phase, kind, relativePaths, options = {}) {
  return {
    id,
    phase,
    kind,
    paths: relativePaths,
    version: 'fixture-version',
    source: 'fixture-source',
    architecture: 'any',
    sha256: null,
    sha256Policy: 'calculate-at-package-time',
    ...options,
  };
}

function manifest(required = [], optional = []) {
  return {
    schemaVersion: 1,
    target: { platform: 'win32', architecture: 'x64' },
    required,
    optional,
  };
}

test('accepts pinned x64 executables and JAR files', async () => {
  const java = makePe();
  const jar = makeZip();
  await writeFixture('runtime/java.exe', java);
  await writeFixture('runtime/spider.jar', jar);

  const result = await inspectReleaseAssets(fixtureRoot, {
    manifest: manifest([
      entry('jre', 'pre-build', 'pe-x64', ['runtime/java.exe'], { sha256: sha256(java) }),
      entry('spider', 'pre-build', 'jar', ['runtime/spider.jar'], { sha256: sha256(jar) }),
    ]),
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.fingerprints, []);
});

test('reports missing assets and missing source pins', async () => {
  const result = await inspectReleaseAssets(fixtureRoot, {
    manifest: manifest([
      entry('jre', 'pre-build', 'pe-x64', ['runtime/missing.exe'], {
        version: null,
        source: null,
        sha256: null,
        sha256Policy: undefined,
      }),
    ]),
  });

  assert.deepEqual(result.errors, [
    'jre: missing version, source, SHA-256 pin(s)',
    'runtime/missing.exe (missing)',
  ]);
});

test('rejects x86 executables, invalid JARs, and checksum mismatches', async () => {
  const x86 = makePe(0x014c);
  const brokenJar = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const wrongHashBytes = Buffer.from('wrong hash');
  await writeFixture('runtime/java-x86.exe', x86);
  await writeFixture('runtime/broken.jar', brokenJar);
  await writeFixture('runtime/hash.bin', wrongHashBytes);

  const result = await inspectReleaseAssets(fixtureRoot, {
    manifest: manifest([
      entry('jre-x86', 'pre-build', 'pe-x64', ['runtime/java-x86.exe']),
      entry('broken-jar', 'pre-build', 'jar', ['runtime/broken.jar']),
      entry('hash-check', 'pre-build', 'file', ['runtime/hash.bin'], { sha256: '0'.repeat(64) }),
    ]),
  });

  assert(result.errors.some((message) => message.includes('runtime/java-x86.exe (not a Windows x64 executable)')));
  assert(result.errors.some((message) => message.includes('runtime/broken.jar (not a valid JAR/ZIP file)')));
  assert(result.errors.some((message) => message.includes('runtime/hash.bin (SHA-256 mismatch;')));
});

test('keeps file names paired when an earlier path is missing', async () => {
  await writeFixture('data/present.bin', Buffer.from('present'));

  const result = await inspectReleaseAssets(fixtureRoot, {
    manifest: manifest([
      entry('pair', 'pre-build', 'files', ['data/missing.bin', 'data/present.bin']),
    ]),
  });

  assert.deepEqual(result.errors, ['data/missing.bin (missing)']);
  assert.equal(result.fingerprints[0]?.path, 'data/present.bin');
});

test('warns for missing optional assets without blocking preflight', async () => {
  const result = await inspectReleaseAssets(fixtureRoot, {
    manifest: manifest([], [
      entry('optional-media', 'optional', 'file', ['media/missing.bin'], { sha256Policy: undefined }),
    ]),
  });

  assert.deepEqual(result.errors, []);
  assert(result.warnings.includes('optional-media: media/missing.bin (missing)'));
  assert(result.warnings.includes('optional-media: SHA-256 is not pinned'));
});

test('requires pins and valid files for optional assets that are present', async () => {
  const validPe = makePe();
  const x86Pe = makePe(0x014c);
  await writeFixture('media/unpinned.exe', validPe);
  await writeFixture('media/x86.exe', x86Pe);
  await writeFixture('media/ffmpeg.exe', validPe);

  const result = await inspectReleaseAssets(fixtureRoot, {
    manifest: manifest([], [
      entry('unpinned', 'optional', 'pe-x64', ['media/unpinned.exe'], { sha256Policy: undefined }),
      entry('wrong-architecture', 'optional', 'pe-x64', ['media/x86.exe'], { sha256: sha256(x86Pe) }),
      entry('partial-media', 'optional', 'files', ['media/ffmpeg.exe', 'media/ffprobe.exe'], {
        sha256: sha256(validPe),
      }),
    ]),
  });

  assert(result.errors.includes('unpinned: missing SHA-256 pin(s)'));
  assert(result.errors.includes('media/x86.exe (not a Windows x64 executable)'));
  assert(result.errors.includes('media/ffprobe.exe (missing)'));
  assert.deepEqual(result.warnings, []);
});

test('accepts a pinned optional asset and fingerprints package-time assets', async () => {
  const jar = makeZip();
  await writeFixture('runtime/compat.jar', jar);

  const result = await inspectReleaseAssets(fixtureRoot, {
    manifest: manifest([], [
      entry('pinned-runtime', 'optional', 'jar', ['runtime/compat.jar'], { sha256: sha256(jar) }),
      entry('generated-runtime', 'optional', 'jar', ['runtime/compat.jar'], { id: 'generated-runtime' }),
    ]),
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.fingerprints, [
    { id: 'generated-runtime', path: 'runtime/compat.jar', sha256: sha256(jar) },
  ]);
});

test('checks provisioned stubs before build and generated assets after main build', async () => {
  const java = makePe();
  await writeFixture('runtime/java.exe', java);
  const assets = manifest([
    entry('jre', 'pre-build', 'pe-x64', ['runtime/java.exe'], { sha256: sha256(java) }),
    entry('spider-stubs', 'pre-build', 'jar', ['runtime/stubs.jar']),
    entry('prefs-shim', 'post-build-main', 'jar', ['runtime/prefs-shim.jar']),
  ]);

  const early = await inspectReleaseAssets(fixtureRoot, { phase: 'pre-build', manifest: assets });
  const complete = await inspectReleaseAssets(fixtureRoot, { phase: 'complete', manifest: assets });

  assert.deepEqual(early.errors, ['runtime/stubs.jar (missing)']);
  assert(complete.errors.includes('runtime/stubs.jar (missing)'));
  assert(complete.errors.includes('runtime/prefs-shim.jar (missing)'));
});

test('validates each JAR in the dex2jar directory', async () => {
  await writeFixture('runtime/d2j/valid.jar', makeZip());
  await writeFixture('runtime/d2j/broken.jar', Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  const result = await inspectReleaseAssets(fixtureRoot, {
    manifest: manifest([
      entry('dex2jar', 'pre-build', 'jar-directory', ['runtime/d2j']),
    ]),
  });

  assert(result.errors.includes('runtime/d2j/broken.jar (not a valid JAR/ZIP file)'));
  assert(result.fingerprints.some((item) => item.path === 'runtime/d2j/valid.jar'));
});

test('declares the provisioned Java runtime and stubs as build prerequisites', async () => {
  const assetManifest = JSON.parse(await readFile(join(root, 'scripts/runtime-assets.json'), 'utf8'));

  for (const id of ['jre17', 'dex2jar', 'spider-stubs']) {
    assert.equal(assetManifest.required.find((item) => item.id === id)?.phase, 'pre-build');
  }
});

test('verifies the checked-in aria2 executable against its x64 checksum pin', async () => {
  const assetManifest = JSON.parse(await readFile(join(root, 'scripts/runtime-assets.json'), 'utf8'));
  const aria2 = assetManifest.optional.find((item) => item.id === 'aria2');
  assert(aria2);

  const result = await inspectReleaseAssets(root, {
    manifest: { ...assetManifest, required: [], optional: [aria2] },
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});


test('requires the generated ARM bridge after the main build', async () => {
  const checked = JSON.parse(await readFile(join(root, 'scripts/runtime-assets.json'), 'utf8'));
  const bridge = checked.required.find(item => item.id === 'native-bridge');
  assert(bridge);
  assert.equal(bridge.phase, 'post-build-main');
  assert(!checked.optional.some(item => item.id === 'native-bridge'));
  const result = await inspectReleaseAssets(fixtureRoot, { manifest: manifest([bridge]), phase: 'post-build-main' });
  assert(result.errors.includes('resources/jvm/native-bridge/native-bridge.jar (missing)'));
});
