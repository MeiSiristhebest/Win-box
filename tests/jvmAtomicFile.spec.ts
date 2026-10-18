import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const exe = process.platform === 'win32' ? '.exe' : '';
const javac = join(bin, 'javac' + exe);
const java = resolve('resources/jvm/jre/bin/java' + exe);

describe.skipIf(!bin || !existsSync(javac) || !existsSync(java))('真实 JVM AtomicFile / PosixFile', () => {
  it('提交、回滚、中断恢复、旧备份、目录映射（不创建虚拟盘）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-atomic-'));
    try {
      const classes = join(dir, 'classes'); mkdirSync(classes);
      const compile = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-d', classes,
        resolve('resources/jvm/stubs-src/android/util/AtomicFile.java'),
        resolve('resources/jvm/native-bridge/com/winbox/nativebridge/PosixFile.java'),
        resolve('tests/fixtures/jvm-native/AtomicFileProbe.java')], { encoding: 'utf8', timeout: 30000 });
      expect(compile.status, compile.stderr).toBe(0);
      const run = spawnSync(java, ['-cp', classes, 'AtomicFileProbe', join(dir, 'data')], { encoding: 'utf8', timeout: 10000 });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('atomic-file-and-posix-ok');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
