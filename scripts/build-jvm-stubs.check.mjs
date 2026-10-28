import assert from 'node:assert/strict';
import test from 'node:test';
import { createJvmStubsBuildPlan } from './build-jvm-stubs.mjs';

test('Windows release plan rebuilds SpiderRunner with the discovered JDK through PowerShell', () => {
  const plan = createJvmStubsBuildPlan({
    root: 'C:/workspace/win-box',
    platform: 'win32',
    javac: 'C:/Java 17/bin/javac.exe',
    jar: 'C:/Java 17/bin/jar.exe',
    powershell: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  });

  assert.equal(plan.executable, 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe');
  assert.deepEqual(plan.args, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', 'C:\\workspace\\win-box\\resources\\jvm\\stubs-src\\build-stubs.ps1',
    '-Javac', 'C:/Java 17/bin/javac.exe',
    '-Jar', 'C:/Java 17/bin/jar.exe',
  ]);
});

test('non-Windows release plan uses the maintained shell builder', () => {
  const plan = createJvmStubsBuildPlan({
    root: '/workspace/win-box',
    platform: 'linux',
    javac: '/jdk/bin/javac',
    jar: '/jdk/bin/jar',
    bash: '/bin/bash',
  });

  assert.equal(plan.executable, '/bin/bash');
  assert.deepEqual(plan.args, [
    '/workspace/win-box/resources/jvm/stubs-src/build-stubs.sh',
    '/jdk/bin/javac',
    '/jdk/bin/jar',
    '/workspace/win-box/resources/jvm/stubs',
    '/workspace/win-box/resources/jvm/stubs/stubs.jar',
  ]);
});

test('release refuses to package an outdated SpiderRunner without a JDK', () => {
  assert.throws(
    () => createJvmStubsBuildPlan({ root: '/workspace/win-box', platform: 'linux', javac: '', jar: '' }),
    /JDK with javac and jar is required/,
  );
});
