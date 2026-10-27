import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { SpiderCallResult } from './spiderCallResult';
import { spiderCallFailed, spiderCallSucceeded } from './spiderCallResult';
import { evaluateSpiderProcessExit } from './spiderProcessOutcome';
import { abortError, throwIfAborted } from '../util/abort';
import { MAX_SPIDER_SUBPROCESS_STDERR_BYTES, MAX_SPIDER_SUBPROCESS_STDOUT_BYTES } from './spiderProcessOutputLimits';

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
      let child: ChildProcess;
      try {
        child = this.ports.spawn(executable, args, {
          windowsHide: true,
          timeout: requestTimeout,
          env: { ...this.ports.processEnvironment(), ...this.ports.proxyEnvironment(), ...env },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.ports.logError(`jvm-bridge spawn 失败: ${message}`);
        resolve(spiderCallFailed('', `运行器进程启动失败：${message}`, null, 'SPIDER_ERROR'));
        return;
      }
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let outputLimitStream: 'stdout' | 'stderr' | null = null;
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
      child.stdout?.setEncoding?.('utf8');
      child.stderr?.setEncoding?.('utf8');
      const capture = (stream: 'stdout' | 'stderr', chunk: string | Buffer): void => {
        if (settled || outputLimitStream) return;
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const bytes = Buffer.byteLength(text, 'utf8');
        const currentBytes = stream === 'stdout' ? stdoutBytes : stderrBytes;
        const maxBytes = stream === 'stdout' ? MAX_SPIDER_SUBPROCESS_STDOUT_BYTES : MAX_SPIDER_SUBPROCESS_STDERR_BYTES;
        if (currentBytes + bytes > maxBytes) {
          outputLimitStream = stream;
          try {
            this.ports.logWarning(`jvm-bridge ${className}.${method}: ${stream} 输出超过 ${maxBytes} 字节上限，已终止该调用`);
          } catch { /* the log adapter must not prevent terminating an oversized child */ }
          abortChild();
          return;
        }
        if (stream === 'stdout') {
          stdout += text;
          stdoutBytes += bytes;
        } else {
          stderr += text;
          stderrBytes += bytes;
        }
      };
      child.stdout?.on('data', (chunk: string | Buffer) => capture('stdout', chunk));
      child.stderr?.on('data', (chunk: string | Buffer) => capture('stderr', chunk));
      child.on('error', (error) => {
        if (!settleOnce()) return;
        if (signal?.aborted) {
          reject(abortError(signal));
          return;
        }
        if (outputLimitStream) {
          resolve(spiderCallFailed('', `${outputLimitStream} 输出超过安全上限（stdout ${MAX_SPIDER_SUBPROCESS_STDOUT_BYTES} 字节，stderr ${MAX_SPIDER_SUBPROCESS_STDERR_BYTES} 字节）`, null, 'SPIDER_OUTPUT_LIMIT'));
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
        if (outputLimitStream) {
          if (outputLimitStream !== 'stderr' && stderr) {
            try { this.ports.logBridgeNotes(stderr); } catch { /* diagnostics are best-effort; the failure result must settle */ }
          }
          resolve(spiderCallFailed('', `${outputLimitStream} 输出超过安全上限（stdout ${MAX_SPIDER_SUBPROCESS_STDOUT_BYTES} 字节，stderr ${MAX_SPIDER_SUBPROCESS_STDERR_BYTES} 字节）`, null, 'SPIDER_OUTPUT_LIMIT'));
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
