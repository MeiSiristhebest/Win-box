import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { DexConstructorRepairCommand } from './dexConstructorRepair';

export interface DexConstructorRepairProcessPorts {
  spawn(executable: string, args: string[], options: SpawnOptions): ChildProcess;
  track(child: ChildProcess): void;
  release(child: ChildProcess): void;
}

/** Owns constructor-repair child output, timeout, termination, and runner tracking. */
export function runDexConstructorRepairProcess(
  command: DexConstructorRepairCommand,
  ports: DexConstructorRepairProcessPorts,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = ports.spawn(command.executable, command.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ports.track(child);

    let output = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ports.release(child);
      if (error) reject(error);
      else resolve(output);
    };
    const timerHandle = setTimeout(() => {
      try { child.kill(); } catch { /* The child may already have exited. */ }
      finish(new Error('DEX 构造器修复超时'));
    }, command.timeoutMs);
    timer = timerHandle;
    timerHandle.unref?.();
    const onData = (data: Buffer | string): void => { output = (output + String(data)).slice(-8000); };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      finish(code === 0
        ? undefined
        : new Error(`DEX 构造器修复失败（code=${code}）：${output.slice(-400)}`));
    });
  });
}
