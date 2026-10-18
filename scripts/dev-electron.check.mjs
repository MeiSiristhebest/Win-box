import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDevElectronRunner } from './dev-electron.mjs';

async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + label);
    await delay(20);
  }
}

async function fixture(quitDelay = 0) {
  const dir = await mkdtemp(join(tmpdir(), 'winbox-dev-runner-'));
  const script = join(dir, 'electron.mjs');
  await writeFile(script, [
    "import { createConnection } from 'node:net';",
    'const socket = createConnection(process.env.WINBOX_DEV_RELOAD_PIPE);',
    "socket.on('connect', () => process.stdout.write('connected\\n'));",
    "socket.on('error', () => process.exit(2));",
    "socket.on('data', (data) => { if(data.toString().includes('quit')) {",
    "process.stdout.write('quit\\n'); setTimeout(() => { socket.end(); process.exit(0); }, " + quitDelay + '); }});',
  ].join('\n'));
  const children = [];
  const output = [];
  const readyFile = join(dir, 'ready');
  const suffix = process.pid + '-' + dir.split(sep).at(-1);
  const pipePath = process.platform === 'win32' ? String.raw`\\.\pipe\winbox-dev-test-` + suffix : join(dir, 'control.sock');
  const runner = createDevElectronRunner({
    projectRoot: dir, readyFile, pipePath, watchIntervalMs: 20, restartDelayMs: 50,
    gracefulTimeoutMs: 2000, forcedTimeoutMs: 1000,
    logger: { log() {}, error(message) { output.push(message); } },
    launch: ({ env }) => {
      const index = children.length;
      const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      children.push(child); output[index] = '';
      child.stdout.on('data', data => { output[index] += data.toString(); });
      return child;
    },
  });
  return {
    runner, children, output, readyFile,
    ready: (serial, pid = process.pid) => writeFile(readyFile, JSON.stringify({ pid, serial })),
    cleanup: async () => {
      await runner.close();
      for (const child of children) if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
      assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('waits for a live build, ignores removed markers and restarts cleanly on success', async () => {
  const f = await fixture();
  try {
    await f.ready(1, 2147483647);
    const starting = f.runner.start();
    await delay(100);
    assert.equal(f.children.length, 0);
    await f.ready(1);
    await starting;
    await until(() => f.output[0]?.includes('connected'), 'first connection');
    await rm(f.readyFile);
    await delay(150);
    assert.equal(f.children.length, 1);
    await f.ready(2);
    await until(() => f.children.length === 2 && f.output[1]?.includes('connected'), 'restart');
    assert.equal(f.children[0].exitCode, 0);
    await f.runner.close();
    assert.equal(await f.runner.done, 0);
    assert.equal(f.children[1].exitCode, 0);
  } finally { await f.cleanup(); }
});

test('waits for rebuilds started during exit and launches only the latest successful build', async () => {
  const f = await fixture(200);
  try {
    await f.ready(1);
    await f.runner.start();
    await until(() => f.output[0]?.includes('connected'), 'first connection');
    await f.ready(2);
    await until(() => f.output[0]?.includes('quit'), 'graceful quit');
    await rm(f.readyFile);
    await until(() => f.children[0].exitCode !== null, 'old process exit');
    await delay(100);
    assert.equal(f.children.length, 1);
    await f.ready(3);
    await until(() => f.children.length === 2 && f.output[1]?.includes('connected'), 'latest build start');
    await delay(200);
    assert.equal(f.children.length, 2);
  } finally { await f.cleanup(); }
});

test('failed process launch closes the control server and reports failure', async () => {
  const f = await fixture();
  try {
    await f.ready(1);
    const runner = createDevElectronRunner({
      readyFile: f.readyFile,
      pipePath: process.platform === 'win32' ? String.raw`\\.\pipe\winbox-dev-fail-` + process.pid : join(tmpdir(), 'winbox-dev-fail-' + process.pid + '.sock'),
      launch: () => spawn(join(resolve(tmpdir()), 'winbox-nonexistent-' + process.pid, 'electron.exe'), [], { windowsHide: true }),
      logger: { log() {}, error() {} },
    });
    await runner.start();
    assert.equal(await runner.done, 1);
  } finally { await f.cleanup(); }
});
