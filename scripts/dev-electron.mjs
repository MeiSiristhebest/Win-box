import { spawn } from 'node:child_process';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function resolveElectronExecutable(projectRoot) {
  const pathFile = join(projectRoot, 'node_modules/electron/path.txt');
  if (!existsSync(pathFile)) throw new Error('未找到 Electron 安装文件，请先安装项目依赖。');
  const name = readFileSync(pathFile, 'utf8').trim() || (process.platform === 'win32' ? 'electron.exe' : 'electron');
  const executable = join(process.env.ELECTRON_OVERRIDE_DIST_PATH?.trim() || join(projectRoot, 'node_modules/electron/dist'), name);
  if (!existsSync(executable)) throw new Error('未找到 Electron 可执行文件：' + executable);
  return executable;
}

function readReadyBuild(file) {
  try {
    const build = JSON.parse(readFileSync(file, 'utf8'));
    if (!Number.isInteger(build.pid) || build.pid <= 0 || !Number.isInteger(build.serial) || build.serial <= 0) return null;
    try { process.kill(build.pid, 0); } catch (error) { if (error.code !== 'EPERM') return null; }
    return build.pid + ':' + build.serial;
  } catch {
    return null;
  }
}

function waitForExit(child, timeoutMs) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const finish = (exited) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

export function createDevElectronRunner({
  projectRoot = defaultRoot,
  readyFile = join(projectRoot, '.tmp/dev-main-build-ready'),
  pipePath = process.platform === 'win32'
    ? String.raw`\\.\pipe\win-box-dev-reload-` + process.pid
    : join(tmpdir(), 'win-box-dev-reload-' + process.pid + '.sock'),
  launch = ({ env }) => spawn(resolveElectronExecutable(projectRoot), ['.'], { cwd: projectRoot, env, stdio: 'inherit', windowsHide: true }),
  restartDelayMs = 350,
  watchIntervalMs = 200,
  gracefulTimeoutMs = 12000,
  forcedTimeoutMs = 2000,
  logger = console,
} = {}) {
  let stopping = false;
  let electronChild = null;
  let electronSocket = null;
  let restartTimer = null;
  let restarting = false;
  let lastStartedBuild = null;
  let closePromise = null;
  const sockets = new Set();
  let finish;
  const done = new Promise((resolveDone) => { finish = resolveDone; });
  const server = createServer((socket) => {
    sockets.add(socket);
    electronSocket?.destroy();
    electronSocket = socket;
    logger.log('[dev] Electron 重启通道已连接');
    socket.setNoDelay(true);
    socket.on('close', () => {
      sockets.delete(socket);
      if (electronSocket === socket) electronSocket = null;
    });
    socket.on('error', () => socket.destroy());
  });

  async function readyBuild() {
    while (!stopping) {
      const build = readReadyBuild(readyFile);
      if (build) return build;
      await delay(50);
    }
    return null;
  }

  function startElectron(build) {
    logger.log('[dev] 启动 Electron');
    lastStartedBuild = build;
    const child = launch({ env: { ...process.env, WINBOX_DEV_RELOAD_PIPE: pipePath } });
    electronChild = child;
    child.on('error', (error) => {
      if (electronChild === child) electronChild = null;
      logger.error('[dev] Electron 启动失败：' + error.message);
      void close(1);
    });
    child.on('exit', (code, signal) => {
      if (electronChild === child) electronChild = null;
      electronSocket?.destroy();
      electronSocket = null;
      if (!stopping && !restarting) {
        logger.log('[dev] Electron 已退出（' + (code ?? signal ?? 'unknown') + '）');
        void close(code ?? (signal ? 1 : 0));
      }
    });
  }

  async function stopElectron() {
    const child = electronChild;
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (electronSocket && !electronSocket.destroyed) {
      logger.log('[dev] 请求 Electron 正常退出');
      electronSocket.write('quit\n');
      if (await waitForExit(child, gracefulTimeoutMs)) return;
      logger.error('[dev] Electron 正常退出超时，结束本次开发进程');
    } else {
      logger.error('[dev] Electron 重启通道尚未连接，结束本次开发进程');
    }
    child.kill();
    if (!await waitForExit(child, forcedTimeoutMs)) throw new Error('旧 Electron 进程未退出，无法启动新进程。');
  }

  async function restartElectron() {
    if (stopping || restarting) return;
    restarting = true;
    try {
      let build = await readyBuild();
      if (stopping || build === lastStartedBuild) return;
      await stopElectron();
      build = await readyBuild();
      if (!stopping && build) startElectron(build);
    } catch (error) {
      logger.error('[dev] Electron 重启失败：' + error.message);
      await close(1);
    } finally {
      restarting = false;
      const build = readReadyBuild(readyFile);
      if (!stopping && build && build !== lastStartedBuild) scheduleRestart();
    }
  }

  function scheduleRestart() {
    if (stopping || !readReadyBuild(readyFile)) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { restartTimer = null; void restartElectron(); }, restartDelayMs);
  }

  function onBuildChange() {
    const build = readReadyBuild(readyFile);
    if (build && build !== lastStartedBuild) scheduleRestart();
  }

  function close(code = 0) {
    if (closePromise) return closePromise;
    stopping = true;
    clearTimeout(restartTimer);
    unwatchFile(readyFile, onBuildChange);
    closePromise = (async () => {
      try { await stopElectron(); } catch (error) { logger.error('[dev] ' + error.message); code = 1; }
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
      finish(code);
      return code;
    })();
    return closePromise;
  }

  async function start() {
    try {
      await new Promise((resolveListen, rejectListen) => {
        const onError = (error) => rejectListen(error);
        server.once('error', onError);
        server.listen(pipePath, () => { server.removeListener('error', onError); resolveListen(); });
      });
      server.on('error', (error) => { logger.error('[dev] ' + error.message); void close(1); });
      logger.log('[dev] 等待主进程和 worker 首次构建完成');
      const build = await readyBuild();
      if (stopping) return;
      watchFile(readyFile, { interval: watchIntervalMs }, onBuildChange);
      startElectron(build);
    } catch (error) {
      logger.error('[dev] ' + error.message);
      await close(1);
    }
  }

  return { start, close, done };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runner = createDevElectronRunner();
  const stop = () => void runner.close();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await runner.start();
    process.exitCode = await runner.done;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
