import { describe, expect, it } from 'vitest';
import { evaluateSpiderProcessExit } from '../src/engine/spider/spiderProcessOutcome';

describe('evaluateSpiderProcessExit', () => {
  it('gives timeout precedence and returns a user-facing reason', () => {
    expect(evaluateSpiderProcessExit({
      stdout: 'partial output',
      stderr: '',
      exitCode: 0,
      timedOut: true,
      timeoutMs: 12500,
    })).toMatchObject({
      reason: '蜘蛛调用超时（>13s），源站可能无响应',
      problemCode: 'SPIDER_TIMEOUT',
      failureKind: null,
      reasonFromSpiderLog: false,
    });
  });

  it('keeps successful output successful even if the process exits nonzero', () => {
    expect(evaluateSpiderProcessExit({
      stdout: '{"ok":true}',
      stderr: 'fatal shutdown warning',
      exitCode: 1,
      timedOut: false,
      timeoutMs: 1000,
    })).toMatchObject({ reason: '', problemCode: null, failureKind: null, shouldLogDiagnostic: true });
  });

  it('translates SpiderLog and retains the raw diagnostic for logging', () => {
    const outcome = evaluateSpiderProcessExit({
      stdout: '',
      stderr: '[android.Log.E] SpiderLog: Connect timed out :: java.net.SocketTimeoutException: Read timed out',
      exitCode: 0,
      timedOut: false,
      timeoutMs: 1000,
    });

    expect(outcome.reason).toBe('连接源站超时，站点可能已停服或网络不通');
    expect(outcome.problemCode).toBe('SPIDER_ERROR');
    expect(outcome.reasonFromSpiderLog).toBe(true);
    expect(outcome.rawSpiderReason).toContain('SocketTimeoutException');
  });

  it('distinguishes an unsupported native ABI from ordinary runner failures', () => {
    const outcome = evaluateSpiderProcessExit({
      stdout: '',
      stderr: '[SpiderRunner.ERROR] UnsatisfiedLinkError: native.dll: machine code=0x34',
      exitCode: 1,
      timedOut: false,
      timeoutMs: 1000,
    });

    expect(outcome.reason).toContain('不能直接由 x64 JVM 加载');
    expect(outcome.shouldLogDiagnostic).toBe(true);
    expect(outcome.diagnosticLine).toContain('[SpiderRunner.ERROR]');
  });

  it('preserves unsupported spider operations as a distinct capability failure', () => {
    const outcome = evaluateSpiderProcessExit({
      stdout: '',
      stderr: '[SpiderRunner.ERROR] java.lang.UnsupportedOperationException: WINBOX_OPERATION_UNSUPPORTED:liveContent',
      exitCode: 1,
      timedOut: false,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({ reason: '该源未提供直播功能', problemCode: 'OPERATION_UNSUPPORTED' });
  });

  it('classifies fatal VM exits separately from an empty successful result', () => {
    const outcome = evaluateSpiderProcessExit({
      stdout: '',
      stderr: 'Native memory allocation (malloc) failed',
      exitCode: 1,
      timedOut: false,
      timeoutMs: 1000,
    });

    expect(outcome.reason).toContain('内存不足');
    expect(outcome.shouldLogDiagnostic).toBe(true);
  });

  it('reports the exit code for an otherwise unexplained runner failure', () => {
    expect(evaluateSpiderProcessExit({
      stdout: '',
      stderr: '',
      exitCode: 17,
      timedOut: false,
      timeoutMs: 1000,
    }).reason).toBe('JVM 进程异常退出（code=17）');
  });
});
