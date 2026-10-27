import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

// JAVA_HOME 指定 JDK 时运行真实 JVM；无 JDK 的 CI 不把静态断言伪装成运行验收。
const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const exe = process.platform === 'win32' ? '.exe' : '';
const javac = join(bin, 'javac' + exe), jar = join(bin, 'jar' + exe);
const jvm = resolve('resources/jvm');
const java = join(jvm, 'jre/bin/java' + exe);
const runnable = !!bin && [java, javac, jar, join(jvm, 'stubs/stubs.jar')].every(existsSync);
let dir = '', runtime = '', fixture = '', cp = '', fullJar = '', shellJar = '', helperJar = '';

function command(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
}

describe.skipIf(!runnable)('真实 JVM 私有蜘蛛类加载（设置 JAVA_HOME）', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'winbox-loader-'));
    runtime = join(dir, 'runtime'); fixture = join(dir, 'fixture');
    mkdirSync(runtime); mkdirSync(fixture);
    cp = [runtime, join(jvm, 'stubs/stubs.jar'), join(jvm, 'libs/*')].join(delimiter);
    command(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', cp, '-d', runtime,
      join(jvm, 'SpiderRunner.java'), join(jvm, 'stubs-src/android/content/Context.java'),
      join(jvm, 'stubs-src/shell-shim/com/github/catvod/spider/DexNative.java')]);
    command(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', cp, '-d', fixture,
      resolve('tests/fixtures/jvm-loader/com/github/catvod/spider/LoaderProbe.java'),
      resolve('tests/fixtures/jvm-loader/fixture/PrivateHelper.java')]);
    fullJar = join(dir, 'full.jar'); shellJar = join(dir, 'shell.jar'); helperJar = join(dir, 'helper.jar');
    command(jar, ['cf', fullJar, '-C', fixture, '.']);
    command(jar, ['cf', shellJar, '-C', fixture, 'com']);
    command(jar, ['cf', helperJar, '-C', fixture, 'fixture']);
  }, 60000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  async function run(method: string, serve = false, shell = false, methodArgs: string[] = []): Promise<string> {
    const args = ['-noverify', '-Dfile.encoding=UTF-8', '-Dtvbox.spiderCacheDir=' + join(dir, 'sandbox'),
      ...(shell ? ['-Dtvbox.shellShimClasses=' + helperJar] : []), '-cp', cp, 'SpiderRunner'];
    const cls = 'com.github.catvod.spider.LoaderProbe';
    if (serve) args.push('--serve', shell ? shellJar : fullJar);
    else args.push(shell ? shellJar : fullJar, cls, method, '', ...methodArgs);
    if (serve) return new Promise<string>((resolve, reject) => {
      const child = spawn(java, args, { windowsHide: true });
      let out = '', err = '', value: string | undefined;
      const timer = setTimeout(() => { child.kill(); reject(new Error('serve timeout: ' + err)); }, 15000);
      child.stderr.on('data', (data) => { err += data; });
      child.stdout.on('data', (data) => {
        out += data;
        if (out.includes('\n') && value === undefined) {
          try {
            const response = JSON.parse(out.slice(0, out.indexOf('\n')));
            if (!response.ok) throw new Error(response.data);
            value = response.data;
            child.stdin.end('quit\n'); // 先收到信封，再停止 daemon 工作线程。
          } catch (error) { child.kill(); reject(error); }
        }
      });
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 || value === undefined) reject(new Error('serve exited: ' + err));
        else resolve(value);
      });
      child.stdin.write(JSON.stringify({ id: '1', className: cls, method, args: ['', ...methodArgs] }) + '\n');
    });
    const result = spawnSync(java, args, { encoding: 'utf8', timeout: 15000 });
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  }

  async function runResidentSequence(requests: Array<{ id: string; method: string; args: string[] }>): Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const args = ['-noverify', '-Dfile.encoding=UTF-8', '-Dtvbox.spiderCacheDir=' + join(dir, 'sandbox'),
        '-cp', cp, 'SpiderRunner', '--serve', fullJar];
      const child = spawn(java, args, { windowsHide: true });
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        rejectPromise(new Error('resident JVM fixture did not finish'));
      }, 15000);
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
        const replies = stdout.trim().split(/\r?\n/).filter(Boolean);
        if (replies.length >= requests.length && child.stdin.writable && !child.stdin.writableEnded) child.stdin.end('quit\n');
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', (error) => {
        clearTimeout(timeout);
        rejectPromise(error);
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        resolvePromise({ code, stdout, stderr });
      });
      for (const request of requests) child.stdin.write(JSON.stringify({ ...request, className: 'com.github.catvod.spider.LoaderProbe' }) + '\n');
    });
  }

  it('Context 能看到已加载蜘蛛的私有类', async () => expect(await run('homeContent')).toBe('private-helper-ok'));
  it('一次性调用 TCCL 能看到私有类', async () => expect(await run('searchContent')).toBe('private-helper-ok'));
  it('常驻工作线程 TCCL 能看到私有类', async () => expect(await run('searchContent', true)).toBe('private-helper-ok'));
  it('一次性与常驻调用都透传 quick 和 page，并兼容旧版 [key, page] 参数', async () => {
    expect(await run('searchContent', false, false, ['book', 'true', '3'])).toBe('private-helper-ok:book:true:3');
    expect(await run('searchContent', true, false, ['book', 'false', '4'])).toBe('private-helper-ok:book:false:4');
    expect(await run('searchContent', false, false, ['book', '5'])).toBe('private-helper-ok:book:false:5');
  });
  it('蜘蛛子线程继承正确加载器', async () => expect(await run('liveContent', true)).toBe('private-helper-ok'));
  it('保留已实现方法的合法空结果（一次性与常驻 JVM）', async () => {
    expect(await run('playerContent')).toBe('');
    expect(await run('playerContent', true)).toBe('');
  });
  it('把继承的兼容空桩报告为未实现操作', async () => {
    const result = spawnSync(java, [
      '-noverify', '-Dfile.encoding=UTF-8', '-Dtvbox.spiderCacheDir=' + join(dir, 'sandbox'),
      '-cp', cp, 'SpiderRunner', fullJar, 'com.github.catvod.spider.LoaderProbe', 'categoryContent', '', 'movie', '1', '',
    ], { encoding: 'utf8', timeout: 15000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('WINBOX_OPERATION_UNSUPPORTED:categoryContent');
  });
  it('一次性与常驻 JVM 都报告蜘蛛异常，且常驻进程在错误后仍可服务', async () => {
    const oneShotFailure = spawnSync(java, [
      '-noverify', '-Dfile.encoding=UTF-8', '-Dtvbox.spiderCacheDir=' + join(dir, 'sandbox'),
      '-cp', cp, 'SpiderRunner', fullJar, 'com.github.catvod.spider.LoaderProbe', 'searchContent', '', 'explode', 'false', '1',
    ], { encoding: 'utf8', timeout: 15000 });
    expect(oneShotFailure.status).toBe(1);
    expect(oneShotFailure.stderr).toContain('fixture execution failed');

    const resident = await runResidentSequence([
      { id: 'before-error', method: 'searchContent', args: ['', 'query', 'false', '3'] },
      { id: 'execution-error', method: 'searchContent', args: ['', 'explode', 'false', '1'] },
      { id: 'legal-empty', method: 'playerContent', args: ['', 'flag', 'id', '[]'] },
      { id: 'after-error', method: 'searchContent', args: ['', 'query', 'false', '4'] },
    ]);
    expect(resident.code, resident.stderr).toBe(0);
    const replies = new Map(resident.stdout.trim().split(/\r?\n/).map((line) => {
      const reply = JSON.parse(line) as { id: string; ok: boolean; data: string };
      return [reply.id, reply] as const;
    }));
    expect(replies.get('before-error')).toMatchObject({ ok: true, data: 'private-helper-ok:query:false:3' });
    expect(replies.get('execution-error')).toMatchObject({ ok: false, data: expect.stringContaining('fixture execution failed') });
    expect(replies.get('legal-empty')).toMatchObject({ ok: true, data: '' });
    expect(replies.get('after-error')).toMatchObject({ ok: true, data: 'private-helper-ok:query:false:4' });
  }, 60000);
  it('shell-shim 缓存加载器仍绑定后续 Context 和 TCCL', async () =>
    expect(await run('homeVideoContent', true, true)).toBe('private-helper-ok:private-helper-ok:private-helper-ok'));
});
