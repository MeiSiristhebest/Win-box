import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const javac = join(bin, process.platform === 'win32' ? 'javac.exe' : 'javac');
const java = resolve('resources/jvm/jre/bin', process.platform === 'win32' ? 'java.exe' : 'java');
describe.skipIf(!bin || !existsSync(javac) || !existsSync(java))('真实 JVM ViewTreeObserver', () => {
  it('反射字段解析、稳定 observer、显式分发与移除，不伪造布局事件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-view-observer-'));
    try {
      const classes = join(dir, 'classes'); mkdirSync(classes);
      const cp = [classes, resolve('resources/jvm/stubs/stubs.jar')].join(delimiter);
      const compile = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', cp, '-d', classes,
        resolve('resources/jvm/stubs-src/android/view/View.java'),
        resolve('resources/jvm/stubs-src/android/view/ViewTreeObserver.java'),
        resolve('resources/jvm/stubs-src/android/widget/Toast.java'),
        resolve('tests/fixtures/jvm-native/ViewTreeObserverProbe.java')], { encoding: 'utf8', timeout: 30000 });
      expect(compile.status, compile.stderr).toBe(0);
      const run = spawnSync(java, ['-cp', cp, 'ViewTreeObserverProbe'], { encoding: 'utf8', timeout: 10000 });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('view-tree-observer-ok');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
