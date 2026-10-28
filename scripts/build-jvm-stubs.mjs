import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, resolve, win32 } from 'node:path';

function commandOnPath(name, platform) {
  try {
    const locator = platform === 'win32' ? 'where.exe' : 'which';
    return execFileSync(locator, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? '';
  } catch {
    return '';
  }
}

export function createJvmStubsBuildPlan({ root, platform, javac, jar, powershell, bash = 'bash' }) {
  if (!javac || !jar) {
    throw new Error('A JDK with javac and jar is required to rebuild the bundled SpiderRunner (set JAVA_HOME or add the JDK bin directory to PATH).');
  }

  const paths = platform === 'win32' ? win32 : posix;
  const jvmRoot = paths.resolve(root, 'resources', 'jvm');
  if (platform === 'win32') {
    if (!powershell) throw new Error('PowerShell is required to rebuild the bundled Java SpiderRunner on Windows.');
    return {
      executable: powershell,
      args: [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', paths.join(jvmRoot, 'stubs-src', 'build-stubs.ps1'),
        '-Javac', javac,
        '-Jar', jar,
      ],
    };
  }

  return {
    executable: bash,
    args: [
      paths.join(jvmRoot, 'stubs-src', 'build-stubs.sh'),
      javac,
      jar,
      paths.join(jvmRoot, 'stubs'),
      paths.join(jvmRoot, 'stubs', 'stubs.jar'),
    ],
  };
}

function discoverTools(root, platform, env) {
  const suffix = platform === 'win32' ? '.exe' : '';
  const fromJavaHome = (tool) => {
    if (!env.JAVA_HOME) return '';
    const candidate = (platform === 'win32' ? win32 : posix).join(env.JAVA_HOME, 'bin', `${tool}${suffix}`);
    return existsSync(candidate) ? candidate : '';
  };
  const locate = (tool) => fromJavaHome(tool) || commandOnPath(`${tool}${suffix}`, platform);
  let powershell = platform === 'win32' ? commandOnPath('powershell.exe', platform) : '';
  if (!powershell && platform === 'win32' && env.SystemRoot) {
    const candidate = win32.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (existsSync(candidate)) powershell = candidate;
  }
  return createJvmStubsBuildPlan({
    root,
    platform,
    javac: locate('javac'),
    jar: locate('jar'),
    powershell,
  });
}

export async function rebuildJvmStubs(root, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const plan = options.plan ?? discoverTools(root, platform, env);
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(plan.executable, plan.args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', rejectRun);
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`Java SpiderRunner build failed (${signal ?? `exit ${code ?? 'unknown'}`}).`));
    });
  });
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isDirectRun) {
  const root = resolve(import.meta.dirname, '..');
  await rebuildJvmStubs(root);
}
