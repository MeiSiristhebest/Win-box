import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const exe = process.platform === 'win32' ? '.exe' : '';
const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const rt = process.env.NATIVE_RUNTIME_DIR || '';
const jvm = resolve('resources/jvm');
const java = join(jvm, 'jre/bin/java' + exe);
const javac = join(bin, 'javac' + exe), jar = join(bin, 'jar' + exe);
const ready = bin && rt && [javac, jar, java, rt, join(jvm, 'stubs/stubs.jar'), join(jvm, 'native-bridge/native-bridge.jar')].every(existsSync);
function command(executable: string, args: string[], timeout = 30000) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout });
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  return result.stdout;
}

describe.skipIf(!ready)('实际发布 JVM 资产', () => {
  it('不依赖源码遮盖，正式 JAR 通过 SQLite / observer / ARM signal / eventfd 探针', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-jvm-assets-'));
    try {
      const cp = [dir, join(jvm, 'stubs/stubs.jar'), join(jvm, 'native-bridge/native-bridge.jar'), join(jvm, 'libs/*'),
        ...readdirSync(rt).filter(n => n.endsWith('.jar')).map(n => join(rt, n))].join(delimiter);
      const fixtures = ['SQLiteProbe', 'ViewTreeObserverProbe', 'ArmSignalProbe', 'ArmEventfdProbe', 'BridgeFileSystemProbe'];
      command(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', cp, '-d', dir,
        ...fixtures.map(n => resolve('tests/fixtures/jvm-native/' + n + '.java'))]);
      for (const [name, marker] of [['SQLiteProbe', 'sqlite-cache-ok'], ['ViewTreeObserverProbe', 'view-tree-observer-ok'],
        ['ArmSignalProbe', 'arm-signals-ok'], ['ArmEventfdProbe', 'arm-eventfd-ok'], ['BridgeFileSystemProbe', 'bridge-files-ok']]) {
        expect(command(java, ['-Djava.io.tmpdir=' + dir, '-cp', cp, name, join(dir, name)]).trim()).toBe(marker);
      }
      const entries = command(jar, ['tf', join(jvm, 'stubs/stubs.jar')]).split(/\r?\n/);
      expect(entries).toContain('android/content/SharedPreferences$Editor.class');
      expect(entries).toContain('android/widget/ScrollView.class');
      expect(entries).toContain('SpiderRunner.class');
      expect(entries).not.toContain('com/github/catvod/spider/DexNative.class');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);

  it.skipIf(process.platform !== 'win32')('重建保留历史资源/基础类，排除基线及源码中的 DexNative shim，支持空格路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-stubs-build-'));
    try {
      const base = join(dir, 'baseline with spaces'), extras = join(dir, 'extra resources');
      mkdirSync(base); mkdirSync(join(extras, 'assets'), { recursive: true });
      mkdirSync(join(extras, 'com/github/catvod/spider'), { recursive: true });
      copyFileSync(join(jvm, 'stubs/stubs.jar'), join(base, 'stubs.jar'));
      writeFileSync(join(extras, 'assets/retained marker.txt'), 'keep this baseline resource');
      // A deliberately polluted baseline must not reintroduce the optional shim.
      writeFileSync(join(extras, 'com/github/catvod/spider/DexNative.class'), 'not a real spider class');
      command(jar, ['uf', join(base, 'stubs.jar'), '-C', extras, '.']);
      const out = join(dir, 'rebuilt stubs.jar');
      command('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(jvm, 'stubs-src/build-stubs.ps1'),
        '-Javac', javac, '-Jar', jar, '-Base', base, '-Out', out], 60000);
      const entries = command(jar, ['tf', out]).split(/\r?\n/);
      expect(entries).toContain('assets/retained marker.txt');
      expect(entries).toContain('android/content/SharedPreferences$Editor.class');
      expect(entries).toContain('android/widget/Toast.class');
      expect(entries).toContain('SpiderRunner.class');
      expect(entries).not.toContain('com/github/catvod/spider/DexNative.class');
      expect(entries.some(n => /^(files|pack)\.txt$|^base\.jar$/.test(n))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 90000);
});
