import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const exe = process.platform === 'win32' ? '.exe' : '';
const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const rt = process.env.NATIVE_RUNTIME_DIR || '';
const jvm = resolve('resources/jvm'), java = join(jvm, 'jre/bin/java' + exe);
const ready = bin && rt && [join(bin, 'javac' + exe), join(bin, 'jar' + exe), java, join(jvm, 'native-bridge/native-bridge.jar'), rt].every(existsSync);
describe.skipIf(!ready)('真实 JVM dynamic native patch', () => {
  it('动态壳/载荷分别转发、禁止宿主加载 ARM、clinit 保留定义加载器', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-native-patch-'));
    const command = (executable: string, args: string[]) => {
      const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000 });
      expect(result.status, result.stderr).toBe(0); return result;
    };
    try {
      const classes = join(dir, 'classes'), fixture = join(dir, 'fixture'); mkdirSync(classes); mkdirSync(fixture);
      const cp = [classes, join(jvm, 'native-bridge/native-bridge.jar'), join(jvm, 'tools/asm-9.11.jar'),
        ...readdirSync(rt).filter(n => n.endsWith('.jar')).map(n => join(rt, n))].join(delimiter);
      const nativeSources = join(jvm, 'native-bridge/com/winbox/nativebridge');
      command(join(bin, 'javac' + exe), ['--release', '17', '-encoding', 'UTF-8', '-cp', cp, '-d', classes,
        ...readdirSync(nativeSources).filter(n => n.endsWith('.java')).map(n => join(nativeSources, n)),
        resolve('tests/fixtures/jvm-native/NativePatchProbe.java'), resolve('tests/fixtures/jvm-native/ArmSignalProbe.java'),
        resolve('tests/fixtures/jvm-native/ArmEventfdProbe.java'), resolve('tests/fixtures/jvm-native/BridgeFileSystemProbe.java')]);
      command(join(bin, 'javac' + exe), ['--release', '17', '-d', fixture, resolve('tests/fixtures/jvm-native/DynamicGuard.java')]);
      const jar = join(dir, 'guard.jar'); command(join(bin, 'jar' + exe), ['cf', jar, '-C', fixture, '.']);
      expect(command(java, ['-cp', cp, 'NativePatchProbe', jar, join(dir, 'patched')]).stdout.trim()).toBe('native-patch-ok');
      expect(command(java, ['-cp', cp, 'ArmSignalProbe', join(dir, 'rootfs')]).stdout.trim()).toBe('arm-signals-ok');
      expect(command(java, ['-cp', cp, 'ArmEventfdProbe', join(dir, 'eventfd-rootfs')]).stdout.trim()).toBe('arm-eventfd-ok');
      expect(command(java, ['-cp', cp, 'BridgeFileSystemProbe', join(dir, 'files-rootfs')]).stdout.trim()).toBe('bridge-files-ok');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
