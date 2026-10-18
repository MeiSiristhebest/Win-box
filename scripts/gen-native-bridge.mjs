import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_RUNTIME_ARTIFACTS, NATIVE_RUNTIME_VERSION } from '../src/engine/spider/nativeRuntimeAssets.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.once('error', rejectRun);
    child.once('close', code => code === 0 ? resolveRun(output.trim()) : rejectRun(new Error(command + ' failed (' + code + '):\n' + output)));
  });
}

async function javaSources(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await javaSources(file));
    else if (entry.name.endsWith('.java')) files.push(file);
  }
  return files.sort();
}

export async function prepareNativeBridgeDependencies({
  dependencyDir = join(root, '.tmp/native-bridge-deps', NATIVE_RUNTIME_VERSION),
  all = false,
} = {}) {
  await mkdir(dependencyDir, { recursive: true });
  const files = [];
  for (const artifact of NATIVE_RUNTIME_ARTIFACTS.filter(item => all || item.compile)) {
    const file = join(dependencyDir, artifact.file);
    let bytes = await readFile(file).catch(() => null);
    if (!bytes || hash(bytes) !== artifact.sha256) {
      const response = await fetch('https://repo.maven.apache.org/maven2/' + artifact.path, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error('ARM bridge dependency ' + artifact.file + ': HTTP ' + response.status);
      bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== artifact.sha256) throw new Error('ARM bridge dependency SHA-256 mismatch: ' + artifact.file);
      const pending = file + '.download-' + process.pid;
      try {
        await writeFile(pending, bytes);
        await rename(pending, file);
      } finally {
        await rm(pending, { force: true });
      }
    }
    files.push(file);
  }
  return files;
}

export async function generateNativeBridge({
  projectRoot = root,
  jdkHome = process.env.WINBOX_JDK_HOME?.trim() || process.env.JAVA_HOME?.trim(),
  dependencyDir = join(projectRoot, '.tmp/native-bridge-deps', NATIVE_RUNTIME_VERSION),
} = {}) {
  const sourceDir = join(projectRoot, 'resources/jvm/native-bridge/com');
  const outJar = join(projectRoot, 'resources/jvm/native-bridge/native-bridge.jar');
  const scratchRoot = resolve(projectRoot, '.tmp');
  const stampFile = join(scratchRoot, 'native-bridge-build-stamp.json');
  const sources = await javaSources(sourceDir);
  const sourceHashes = await Promise.all(sources.map(async file => [file.slice(sourceDir.length), hash(await readFile(file))]));
  const signature = hash(JSON.stringify({ format: 1, release: 17, sources: sourceHashes, dependencies: NATIVE_RUNTIME_ARTIFACTS.filter(item => item.compile) }));
  try {
    const stamp = JSON.parse(await readFile(stampFile, 'utf8'));
    const existing = await readFile(outJar);
    if (stamp.signature === signature && stamp.sha256 === hash(existing)) return { outJar, bytes: existing.length, cached: true, sha256: stamp.sha256 };
  } catch { /* Build the missing or stale artifact. */ }

  const javac = jdkHome ? join(jdkHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac') : 'javac';
  const jar = jdkHome ? join(jdkHome, 'bin', process.platform === 'win32' ? 'jar.exe' : 'jar') : 'jar';
  try { await run(javac, ['-version']); await run(jar, ['--version']); }
  catch (error) { throw new Error('ARM bridge needs JDK 17 or newer. Set WINBOX_JDK_HOME or JAVA_HOME. ' + error.message); }
  const dependencies = await prepareNativeBridgeDependencies({ dependencyDir });
  await mkdir(scratchRoot, { recursive: true });
  const temporaryDir = await mkdtemp(join(scratchRoot, 'native-bridge-build-'));
  if (!resolve(temporaryDir).startsWith(scratchRoot + sep)) throw new Error('Invalid bridge build cleanup path');
  try {
    const classes = join(temporaryDir, 'classes');
    await mkdir(classes);
    await run(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', dependencies.join(process.platform === 'win32' ? ';' : ':'), '-d', classes, ...sources]);
    const stagedJar = join(temporaryDir, 'native-bridge.jar');
    await run(jar, ['--create', '--file', stagedJar, '-C', classes, '.']);
    const bytes = await readFile(stagedJar);
    const sha256 = hash(bytes);
    await mkdir(dirname(outJar), { recursive: true });
    await rename(stagedJar, outJar);
    await writeFile(stampFile, JSON.stringify({ signature, sha256 }, null, 2) + '\n');
    return { outJar, bytes: bytes.length, cached: false, sha256 };
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const result = await generateNativeBridge({ jdkHome: value('--jdk'), dependencyDir: value('--deps') });
  console.log('native-bridge: ' + (result.cached ? 'up to date' : 'built') + ' (' + result.bytes + ' bytes, SHA-256 ' + result.sha256 + ')');
}
