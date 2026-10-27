import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDexConstructorRepairProcess } from '../src/engine/spider/dexConstructorRepairProcess';
import type { DexConstructorRepairCommand } from '../src/engine/spider/dexConstructorRepair';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

const command: DexConstructorRepairCommand = {
  executable: 'java.exe',
  args: ['-cp', 'bridge.jar;d2j.jar', 'com.winbox.nativebridge.DexJarRepair'],
  timeoutMs: 1_000,
};

function createPorts(child = fakeChild()) {
  const ports = {
    spawn: vi.fn(() => child as unknown as ChildProcess),
    track: vi.fn(),
    release: vi.fn(),
  };
  return { child, ports };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runDexConstructorRepairProcess', () => {
  it('collects stdout and stderr, then releases the tracked process on successful close', async () => {
    vi.useFakeTimers();
    const { child, ports } = createPorts();
    const result = runDexConstructorRepairProcess(command, ports);
    child.stdout.emit('data', '[dexjar-repair] ');
    child.stderr.emit('data', Buffer.from('fixed sites = 12'));
    child.emit('close', 0);

    await expect(result).resolves.toBe('[dexjar-repair] fixed sites = 12');
    expect(ports.track).toHaveBeenCalledOnce();
    expect(ports.release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills and releases the child when the repair timeout expires', async () => {
    vi.useFakeTimers();
    const { child, ports } = createPorts();
    const result = runDexConstructorRepairProcess(command, ports);
    const rejection = expect(result).rejects.toThrow('DEX 构造器修复超时');

    await vi.advanceTimersByTimeAsync(command.timeoutMs);
    await rejection;

    expect(child.kill).toHaveBeenCalledOnce();
    expect(ports.release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects nonzero close with the captured diagnostic tail and releases the child', async () => {
    const { child, ports } = createPorts();
    const result = runDexConstructorRepairProcess(command, ports);
    child.stderr.emit('data', 'repair crashed');
    child.emit('close', 2);

    await expect(result).rejects.toThrow('DEX 构造器修复失败（code=2）：repair crashed');
    expect(ports.release).toHaveBeenCalledOnce();
  });
});
