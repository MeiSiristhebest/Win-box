import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { SpiderSubprocessRunner, type SpiderSubprocessRunnerPorts } from '../src/engine/spider/SpiderSubprocessRunner';

describe('SpiderSubprocessRunner', () => {
  it('settles a spawn error once even when Node follows it with close', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const logError = vi.fn();
    const logInfo = vi.fn();
    const ports: SpiderSubprocessRunnerPorts = {
      spawn: (_executable: string, _args: string[], _options: SpawnOptions) => child,
      processEnvironment: () => ({}),
      proxyEnvironment: () => ({}),
      logBridgeNotes: vi.fn(),
      logError,
      logWarning: vi.fn(),
      logInfo,
    };
    const runner = new SpiderSubprocessRunner(ports, 1000);

    const result = runner.run('python.exe', [], 'Spider', 'search');
    child.emit('error', new Error('ENOENT'));
    child.emit('close', -2, null);

    await expect(result).resolves.toMatchObject({
      ok: false,
      reason: '运行器进程启动失败：ENOENT',
      problemCode: 'SPIDER_ERROR',
    });
    expect(logError).toHaveBeenCalledOnce();
    expect(logInfo).not.toHaveBeenCalled();
  });
});
