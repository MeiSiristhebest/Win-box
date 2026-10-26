import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { SpiderSubprocessRunner, type SpiderSubprocessRunnerPorts } from '../src/engine/spider/SpiderSubprocessRunner';
import { MAX_SPIDER_SUBPROCESS_STDERR_BYTES, MAX_SPIDER_SUBPROCESS_STDOUT_BYTES } from '../src/engine/spider/spiderProcessOutputLimits';

describe('SpiderSubprocessRunner', () => {
  function makeRunner(child: ChildProcess, spawn: SpiderSubprocessRunnerPorts['spawn'] = () => child) {
    const ports: SpiderSubprocessRunnerPorts = {
      spawn,
      processEnvironment: () => ({}),
      proxyEnvironment: () => ({}),
      logBridgeNotes: vi.fn(),
      logError: vi.fn(),
      logWarning: vi.fn(),
      logInfo: vi.fn(),
    };
    return { runner: new SpiderSubprocessRunner(ports, 1000), ports };
  }

  it('settles a spawn error once even when Node follows it with close', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const { runner, ports } = makeRunner(child, (_executable, _args, _options) => child);

    const result = runner.run('python.exe', [], 'Spider', 'search');
    child.emit('error', new Error('ENOENT'));
    child.emit('close', -2, null);

    await expect(result).resolves.toMatchObject({
      ok: false,
      reason: '运行器进程启动失败：ENOENT',
      problemCode: 'SPIDER_ERROR',
    });
    expect(ports.logError).toHaveBeenCalledOnce();
    expect(ports.logInfo).not.toHaveBeenCalled();
  });

  it('maps a synchronously thrown spawn-port failure to the same startup result as an async spawn error', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const { runner, ports } = makeRunner(child, () => { throw new Error('spawn adapter unavailable'); });

    await expect(runner.run('python.exe', [], 'Spider', 'search')).resolves.toMatchObject({
      ok: false,
      reason: '运行器进程启动失败：spawn adapter unavailable',
      problemCode: 'SPIDER_ERROR',
    });
    expect(ports.logError).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills a running child and rejects with the caller cancellation when aborted', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const { runner } = makeRunner(child);
    const controller = new AbortController();
    const result = runner.run('python.exe', [], 'Spider', 'search', 10_000, undefined, controller.signal);

    controller.abort(new Error('search cancelled'));
    child.emit('exit', null, 'SIGTERM');
    child.emit('close', null, 'SIGTERM');

    await expect(result).rejects.toMatchObject({ name: 'AbortError', message: 'search cancelled' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('preserves a multi-line result on stdout and multi-line diagnostics on stderr', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const { runner, ports } = makeRunner(child);
    const result = runner.run('java.exe', [], 'Spider', 'search');

    child.stdout?.emit('data', '{\n  "list": []\n}');
    child.stderr?.emit('data', '[native-bridge] ready\n[SpiderRunner] warning\n');
    child.emit('close', 0, null);

    await expect(result).resolves.toMatchObject({ ok: true, output: '{\n  "list": []\n}' });
    expect(ports.logBridgeNotes).toHaveBeenCalledWith('[native-bridge] ready\n[SpiderRunner] warning\n');
  });

  it('preserves UTF-8 when a multibyte character is split across native output chunks', async () => {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const { runner } = makeRunner(child);
    const result = runner.run('python.exe', [], 'Spider', 'search');
    const encoded = Buffer.from('搜索结果');

    stdout.write(encoded.subarray(0, 2));
    stdout.write(encoded.subarray(2));
    child.emit('close', 0, null);

    await expect(result).resolves.toMatchObject({ ok: true, output: '搜索结果' });
  });

  it('fails visibly and returns no partial result when stdout exceeds its byte limit', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const { runner, ports } = makeRunner(child);
    const result = runner.run('python.exe', [], 'Spider', 'search');

    child.stdout?.emit('data', '汉'.repeat(Math.floor(MAX_SPIDER_SUBPROCESS_STDOUT_BYTES / 3) + 1));
    child.emit('close', 1, null);

    await expect(result).resolves.toMatchObject({
      ok: false,
      output: '',
      problemCode: 'SPIDER_OUTPUT_LIMIT',
      reason: expect.stringContaining('stdout 输出超过安全上限'),
    });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(ports.logWarning).toHaveBeenCalledOnce();
  });

  it('fails visibly when stderr diagnostics exceed their byte limit', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const { runner, ports } = makeRunner(child);
    const result = runner.run('java.exe', [], 'Spider', 'detail');

    child.stderr?.emit('data', 'd'.repeat(MAX_SPIDER_SUBPROCESS_STDERR_BYTES + 1));
    child.emit('close', 1, null);

    await expect(result).resolves.toMatchObject({
      ok: false,
      output: '',
      problemCode: 'SPIDER_OUTPUT_LIMIT',
      reason: expect.stringContaining('stderr 输出超过安全上限'),
    });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(ports.logBridgeNotes).not.toHaveBeenCalled();
  });
});
