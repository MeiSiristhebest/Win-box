import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const javac = join(bin, 'javac.exe');
const java = resolve('resources/jvm/jre/bin/java.exe');
describe.skipIf(process.platform !== 'win32' || !bin || !existsSync(javac) || !existsSync(java))('Windows DPAPI AndroidKeyStore', () => {
  it('AES/GCM 加密、跨 JVM 解密、删除，并拒绝伪造硬件认证', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-keystore-'));
    try {
      const classes = join(dir, 'classes'); mkdirSync(classes);
      const compile = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-d', classes,
        resolve('resources/jvm/stubs-src/android/util/AtomicFile.java'),
        resolve('resources/jvm/stubs-src/android/security/keystore/KeyGenParameterSpec.java'),
        resolve('resources/jvm/stubs-src/android/security/keystore/DesktopKeyStoreProvider.java'),
        resolve('tests/fixtures/jvm-native/KeyStoreProbe.java')], { encoding: 'utf8', timeout: 30000 });
      expect(compile.status, compile.stderr).toBe(0);
      for (const mode of ['create', 'read']) {
        const run = spawnSync(java, ['-cp', classes, 'KeyStoreProbe', join(dir, 'data'), mode], { encoding: 'utf8', timeout: 60000 });
        expect(run.status, run.stderr).toBe(0);
        expect(run.stdout.trim()).toBe(`keystore-${mode}-ok`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120000);
});
