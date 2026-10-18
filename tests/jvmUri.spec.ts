import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const exe = process.platform === 'win32' ? '.exe' : '';
const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const javac = join(bin, 'javac' + exe);
const java = resolve('resources/jvm/jre/bin/java' + exe);
const stubs = resolve('resources/jvm/stubs/stubs.jar');

describe.skipIf(!bin || !existsSync(javac) || !existsSync(java))('真实 JVM Uri', () => {
  it('正式 JAR 提供最后路径段 API，解码后保留加号和嵌入斜杠', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-uri-'));
    try {
      const compile = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', stubs, '-d', dir,
        resolve('tests/fixtures/jvm-native/UriProbe.java')], { encoding: 'utf8', timeout: 30000 });
      expect(compile.status, compile.stderr).toBe(0);
      const run = spawnSync(java, ['-cp', [dir, stubs].join(delimiter), 'UriProbe'], { encoding: 'utf8', timeout: 10000 });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('uri-path-ok');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 45000);

  it('兼容旧 JAR 编译出的 buildUpon(): Uri 二进制描述符', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-uri-legacy-'));
    try {
      const api = join(dir, 'api', 'android', 'net');
      const probe = join(dir, 'probe');
      mkdirSync(api, { recursive: true });
      mkdirSync(probe);
      const legacy = join(api, 'Uri.java');
      writeFileSync(legacy, 'package android.net; public class Uri { public static Uri parse(String s){return null;} public Uri buildUpon(){return null;} }');
      const compileApi = spawnSync(javac, ['--release', '17', '-d', join(dir, 'api'), legacy], { encoding: 'utf8', timeout: 30000 });
      expect(compileApi.status, compileApi.stderr).toBe(0);
      const compileProbe = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', join(dir, 'api'), '-d', probe,
        resolve('tests/fixtures/jvm-native/UriLegacyProbe.java')], { encoding: 'utf8', timeout: 30000 });
      expect(compileProbe.status, compileProbe.stderr).toBe(0);
      const run = spawnSync(java, ['-cp', [probe, stubs].join(delimiter), 'UriLegacyProbe'], { encoding: 'utf8', timeout: 10000 });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('uri-legacy-ok');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 75000);
});
