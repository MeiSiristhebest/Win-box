import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { SpiderCallResult } from './spiderCallResult';
import { spiderCallFailed, spiderCallSucceeded } from './spiderCallResult';
import { evaluateSpiderProcessExit } from './spiderProcessOutcome';
import { abortError, throwIfAborted } from '../util/abort';

export interface SpiderSubprocessRunnerPorts {
  spawn(executable: string, args: string[], options: SpawnOptions): ChildProcess;
  processEnvironment(): NodeJS.ProcessEnv;
  proxyEnvironment(): Record<string, string>;
  logBridgeNotes(text: string): void;
  logError(message: string): void;
  logWarning(message: string): void;
  logInfo(message: string): void;
}

/** Owns one-shot child-process I/O, cancellation, timeout classification and cleanup. */
export class SpiderSubprocessRunner {
  private readonly activeChildren = new Set<ChildProcess>();

  constructor(private readonly ports: SpiderSubprocessRunnerPorts, private readonly defaultTimeoutMs: number) {}

  track(child: ChildProcess): void {
    this.activeChildren.add(child);
    child.on('exit', () => this.activeChildren.delete(child));
  }

  release(child: ChildProcess): void {
    this.activeChildren.delete(child);
  }

  run(
    executable: string,
    args: string[],
    className: string,
    method: string,
    timeoutMs?: number,
    env?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<SpiderCallResult> {
    return new Promise<SpiderCallResult>((resolve, reject) => {
      throwIfAborted(signal);
      const requestTimeout = timeoutMs ?? this.defaultTimeoutMs;
      const child = this.ports.spawn(executable, args, {
        windowsHide: true,
        timeout: requestTimeout,
        env: { ...this.ports.processEnvironment(), ...this.ports.proxyEnvironment(), ...env },
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const detachAbort = (): void => signal?.removeEventListener('abort', abortChild);
      const settleOnce = (): boolean => {
        if (settled) return false;
        settled = true;
        detachAbort();
        this.release(child);
        return true;
      };
      const abortChild = (): void => {
        try { child.kill(); } catch { /* 子进程可能已退出 */ }
      };
      signal?.addEventListener('abort', abortChild, { once: true });
      if (signal?.aborted) abortChild();
      this.track(child);
      child.stdout?.on('data', (chunk) => { stdout += chunk; });
      child.stderr?.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => {
        if (!settleOnce()) return;
        if (signal?.aborted) {
          reject(abortError(signal));
          return;
        }
        this.ports.logError(`jvm-bridge spawn 失败: ${error.message}`);
        resolve(spiderCallFailed('', `运行器进程启动失败：${error.message}`, null, 'SPIDER_ERROR'));
      });
      child.on('exit', (_code, exitSignal) => {
        if (exitSignal === 'SIGTERM') timedOut = true;
      });
      child.on('close', (exitCode) => {
        if (!settleOnce()) return;
        if (signal?.aborted) {
          reject(abortError(signal));
          return;
        }
        const outcome = evaluateSpiderProcessExit({ stdout, stderr, exitCode, timedOut, timeoutMs: requestTimeout });
        const { reason, failureKind, problemCode } = outcome;
        if (stderr) {
          this.ports.logBridgeNotes(stderr);
          if (outcome.shouldLogDiagnostic) {
            if (exitCode !== 0) this.ports.logWarning(`jvm-bridge ${className}.${method}: ${outcome.diagnosticLine}`);
            else this.ports.logWarning(`jvm-bridge ${className}.${method} (退出0但有日志): ${outcome.diagnosticLine}`);
          }
        }
        if (reason) {
          const rawSuffix = outcome.reasonFromSpiderLog && outcome.rawSpiderReason ? `｜原始: ${outcome.rawSpiderReason}` : '';
          this.ports.logInfo(`jvm-bridge ${className}.${method} 失败原因: ${reason}${rawSuffix}`);
        }
        resolve(reason
          ? spiderCallFailed(stdout.trim(), reason, failureKind, problemCode ?? 'SPIDER_ERROR')
          : spiderCallSucceeded(stdout.trim()));
      });
    });
  }

  dispose(): void {
    for (const child of this.activeChildren) {
      try { child.kill(); } catch { /* 子进程可能已退出 */ }
    }
    this.activeChildren.clear();
  }
}
