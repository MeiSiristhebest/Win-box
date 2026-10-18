import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const exe = process.platform === 'win32' ? '.exe' : '';
const javac = join(bin, 'javac' + exe), java = resolve('resources/jvm/jre/bin/java' + exe);
const jvm = resolve('resources/jvm');
const ready = bin && [javac, java, join(jvm, 'libs/sqlite-jdbc-3.53.4.0.jar')].every(existsSync);
describe.skipIf(!ready)('真实 JVM SQLite cache', () => {
  it('建表、replace、参数查询、过期删除、事务回滚/提交、重开及升级', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-sqlite-'));
    try {
      const classes = join(dir, 'classes'); mkdirSync(classes);
      const cp = [classes, join(jvm, 'stubs/stubs.jar'), join(jvm, 'libs/*')].join(delimiter);
      const sources = readdirSync(join(jvm, 'stubs-src/android/database/sqlite')).filter(n => n.endsWith('.java')).map(n => join(jvm, 'stubs-src/android/database/sqlite', n));
      const compile = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', cp, '-d', classes,
        ...sources, resolve('tests/fixtures/jvm-native/SQLiteProbe.java')], { encoding: 'utf8', timeout: 30000 });
      expect(compile.status, compile.stderr).toBe(0);
      const run = spawnSync(java, ['-Djava.io.tmpdir=' + dir, '-cp', cp, 'SQLiteProbe', join(dir, 'data')], { encoding: 'utf8', timeout: 30000 });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('sqlite-cache-ok');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
