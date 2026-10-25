import {
  classifySpiderFailure,
  extractSpiderReason,
  extractSpiderReasonRaw,
  stripJvmNoise,
  translateSpiderLog,
  type SpiderFailureKind,
} from './spiderDiagnostics';
import type { SourceProblemCode } from './errors';
import { normalizeSpiderRuntimeFailure } from './spiderRuntimeFailure';

export interface SpiderProcessExit {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  timeoutMs: number;
}

export interface SpiderProcessOutcome {
  reason: string;
  problemCode: SourceProblemCode | null;
  failureKind: SpiderFailureKind | null;
  rawSpiderReason: string;
  reasonFromSpiderLog: boolean;
  diagnosticLine: string;
  shouldLogDiagnostic: boolean;
}

/** Purely interprets a subprocess exit; spawning, logging, and state mutation stay with the caller. */
export function evaluateSpiderProcessExit(exit: SpiderProcessExit): SpiderProcessOutcome {
  const spiderLog = extractSpiderReason(exit.stderr);
  const rawSpiderReason = extractSpiderReasonRaw(exit.stderr);
  const runnerError = exit.stderr.match(/\[SpiderRunner\.ERROR\][^\n]*/)?.[0]?.trim() ?? '';
  const outputIsEmpty = !exit.stdout.trim();

  let reason = '';
  let problemCode: SourceProblemCode | null = null;
  let failureKind: SpiderFailureKind | null = null;
  let reasonFromSpiderLog = false;

  if (exit.timedOut) {
    reason = `蜘蛛调用超时（>${Math.round(exit.timeoutMs / 1000)}s），源站可能无响应`;
    problemCode = 'SPIDER_TIMEOUT';
  } else if (!outputIsEmpty) {
    reason = '';
  } else if (spiderLog) {
    reason = translateSpiderLog(spiderLog);
    failureKind = classifySpiderFailure(spiderLog);
    reasonFromSpiderLog = true;
  } else if (runnerError) {
    const raw = runnerError.replace('[SpiderRunner.ERROR]', '').trim();
    const runtimeFailure = normalizeSpiderRuntimeFailure(raw);
    failureKind = runtimeFailure.failureKind;
    if (runtimeFailure.problemCode === 'OPERATION_UNSUPPORTED') {
      reason = runtimeFailure.reason;
      problemCode = runtimeFailure.problemCode;
    } else {
      const abiMismatch = /Can't load this \.dll|machine code=0x[0-9a-f]+|wrong ELF class|not a valid Win32 application/i.test(exit.stderr);
      const androidShell = /DexNative|UnsatisfiedLinkError|dalvik[/.]system[/.]/.test(exit.stderr);
      reason = abiMismatch
        ? 'ARM 原生库（.so）未通过兼容桥加载，请检查原生运行时下载和该源的桥接日志；不能直接由 x64 JVM 加载'
        : androidShell
          ? '安卓壳或原生调用失败，当前兼容桥未能执行该源，请检查该源依赖与桥接日志'
          : `蜘蛛运行器异常：${runtimeFailure.reason}`;
    }
  } else if (exit.exitCode !== 0) {
    const nativeCrash =
      /insufficient memory|Native memory allocation|Out of Memory Error/i.test(exit.stderr) ||
      /hs_err_pid/i.test(exit.stderr) ||
      (exit.exitCode !== 0 && /SIGSEGV|EXCEPTION_ACCESS_VIOLATION/i.test(exit.stderr));
    reason = nativeCrash
      ? '桌面 JVM 运行时内存不足（该源需要更大的转换内存），请反馈此源'
      : `JVM 进程异常退出（code=${exit.exitCode}）`;
  }

  if (reason && problemCode === null) problemCode = 'SPIDER_ERROR';

  const diagnosticStart = runnerError ? exit.stderr.indexOf(runnerError) : -1;
  const frames = diagnosticStart >= 0
    ? exit.stderr.slice(diagnosticStart).split('\n').slice(1, 4).join(' | ')
    : '';
  const diagnosticLine = runnerError
    ? `${runnerError}${frames ? `  ↳ ${frames}` : ''}`
    : stripJvmNoise(exit.stderr).split('\n')[0].slice(0, 120);

  return {
    reason,
    problemCode,
    failureKind,
    rawSpiderReason,
    reasonFromSpiderLog,
    diagnosticLine,
    shouldLogDiagnostic: !!exit.stderr && (exit.exitCode !== 0 || !!runnerError),
  };
}
