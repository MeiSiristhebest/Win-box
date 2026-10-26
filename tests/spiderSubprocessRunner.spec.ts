import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { SpiderSubprocessRunner, type SpiderSubprocessRunnerPorts } from '../src/engine/spider/SpiderSubprocessRunner';

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
});
