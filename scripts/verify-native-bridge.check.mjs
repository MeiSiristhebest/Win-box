import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNativeBridge, prepareNativeBridgeDependencies } from './gen-native-bridge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function command(executable, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.once('error', rejectCommand);
    child.once('close', code => code === 0 ? resolveCommand(stdout) : rejectCommand(new Error(stderr || stdout || String(code))));
  });
}

test('Java 17 bridge executes ARM32/AArch64 and eventfd/epoll using real native backends', { timeout: 240000 }, async () => {
  const bridge = await generateNativeBridge();
  const dependencies = await prepareNativeBridgeDependencies({ all: true });
  const scratchRoot = resolve(root, '.tmp');
  await mkdir(scratchRoot, { recursive: true });
  const temp = await mkdtemp(join(scratchRoot, 'native-bridge-check-'));
  try {
    const jdk = process.env.WINBOX_JDK_HOME?.trim() || process.env.JAVA_HOME?.trim();
    const javac = jdk ? join(jdk, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac') : 'javac';
    const classpath = [bridge.outJar, ...dependencies].join(process.platform === 'win32' ? ';' : ':');
    await command(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', classpath, '-d', temp, join(root, 'tests/fixtures/NativeBridgeSmoke.java')]);
    const java = join(root, 'resources/jvm/jre/bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const output = await command(java, ['-cp', temp + (process.platform === 'win32' ? ';' : ':') + classpath, 'NativeBridgeSmoke', temp]);
    assert.match(output, /Native bridge runtime passed: 22 assertions/);
    console.log(output.trim());
    const cached = await generateNativeBridge({ jdkHome: join(temp, 'missing-jdk') });
    assert.equal(cached.cached, true);
    assert.equal(cached.sha256, bridge.sha256);
  } finally {
    assert.ok(resolve(temp).startsWith(scratchRoot + sep));
    await rm(temp, { recursive: true, force: true });
  }
});
