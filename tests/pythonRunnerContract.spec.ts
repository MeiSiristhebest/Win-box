import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pythonCandidates = process.env.PYTHON
  ? [process.env.PYTHON]
  : process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];

const python = pythonCandidates.find((command) => {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  return !result.error && result.status === 0;
});

describe.skipIf(!python)('Python runner capability contract', () => {
  it('distinguishes inherited stubs from empty overrides and propagates init errors', () => {
    const script = join(process.cwd(), 'architecture-audit', 'evidence', 'python-capabilities.probe.py');
    const result = spawnSync(python as string, [script], { encoding: 'utf8', windowsHide: true });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 6 tests');
  });

  it('真实 runner 单次和常驻进程遵守能力、空结果、执行失败与恢复契约', async () => {
    const root = mkdtempSync(join(tmpdir(), 'winbox-python-runner-contract-'));
    const runtime = join(root, 'runtime');
    const spiderPath = join(root, 'fixture_spider.py');
    const runnerPath = join(runtime, 'runner.py');
    try {
      mkdirSync(join(runtime, 'base'), { recursive: true });
      cpSync(resolve('resources/jvm/python-runner/runner.py'), runnerPath);
      cpSync(resolve('resources/jvm/python-runner/base/spider.py'), join(runtime, 'base', 'spider.py'));
      // Keep the probe independent of optional host Python packages; fixture code never performs I/O.
      writeFileSync(join(runtime, 'requests.py'), 'def get(*args, **kwargs):\n    raise AssertionError("network is not part of this probe")\n');
      writeFileSync(join(runtime, 'urllib3.py'), 'def disable_warnings():\n    pass\n');
      writeFileSync(spiderPath, [
        'from base.spider import Spider as BaseSpider',
        'class Spider(BaseSpider):',
        '    def init(self, ext=""):',
        '        if ext == "bad-init": raise TypeError("fixture init failed")',
        '    def searchContent(self, key, quick, pg="1"):',
        '        print("fixture crawler diagnostic")',
        '        if key == "explode": raise RuntimeError("fixture execution failed")',
        '        return {"list": [], "page": int(pg)}',
      ].join('\n') + '\n');

      const once = (method: string, ext: string, args: string[]) => spawnSync(
        python as string,
        [runnerPath, spiderPath, 'Spider', method, ext, ...args],
        { encoding: 'utf8', timeout: 10000, windowsHide: true },
      );

      const empty = once('searchContent', '', ['query', 'false', '2']);
      expect(empty.error).toBeUndefined();
      expect(empty.status, empty.stderr).toBe(0);
      expect(JSON.parse(empty.stdout)).toEqual({ list: [], page: 2 });
      expect(empty.stderr).toContain('fixture crawler diagnostic');

      const unsupported = once('homeVideoContent', '', []);
      expect(unsupported.status).toBe(1);
      expect(unsupported.stderr).toContain('WINBOX_OPERATION_UNSUPPORTED:homeVideoContent');

      const executionFailure = once('searchContent', '', ['explode', 'false', '1']);
      expect(executionFailure.status).toBe(1);
      expect(executionFailure.stderr).toContain('RuntimeError: fixture execution failed');

      const initFailure = once('searchContent', 'bad-init', ['query', 'false', '1']);
      expect(initFailure.status).toBe(1);
      expect(initFailure.stderr).toContain('TypeError: fixture init failed');

      const daemon = await runResidentRunner(python as string, runnerPath, spiderPath);
      expect(daemon.code, daemon.stderr).toBe(0);
      const envelopes = daemon.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
        id: string;
        ok: boolean;
        data: string;
      });
      expect(envelopes.map(({ id }) => id)).toEqual(['unsupported', 'empty', 'failed', 'init-failed', 'recovered']);
      expect(envelopes[0]).toMatchObject({ ok: false, data: expect.stringContaining('WINBOX_OPERATION_UNSUPPORTED:homeVideoContent') });
      expect(envelopes[1].ok).toBe(true);
      expect(JSON.parse(envelopes[1].data)).toEqual({ list: [], page: 3 });
      expect(envelopes[2]).toMatchObject({ ok: false, data: expect.stringContaining('RuntimeError: fixture execution failed') });
      expect(envelopes[3]).toMatchObject({ ok: false, data: expect.stringContaining('TypeError: fixture init failed') });
      expect(envelopes[4].ok).toBe(true);
      expect(JSON.parse(envelopes[4].data)).toEqual({ list: [], page: 4 });
      expect(daemon.stderr).toContain('fixture crawler diagnostic');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});

function runResidentRunner(
  pythonCommand: string,
  runnerPath: string,
  spiderPath: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonCommand, [runnerPath, '-serve', spiderPath, 'Spider'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error('Python resident runner did not exit after quit request'));
    }, 15000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolvePromise({ code, stdout, stderr });
    });
    const requests = [
      { id: 'unsupported', method: 'homeVideoContent', args: [''] },
      { id: 'empty', method: 'searchContent', args: ['', 'query', 'false', '3'] },
      { id: 'failed', method: 'searchContent', args: ['', 'explode', 'false', '1'] },
      { id: 'init-failed', method: 'searchContent', args: ['bad-init', 'query', 'false', '1'] },
      { id: 'recovered', method: 'searchContent', args: ['', 'query', 'false', '4'] },
      { quit: true },
    ];
    child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
  });
}
