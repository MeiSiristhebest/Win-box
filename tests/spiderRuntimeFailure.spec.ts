import { describe, expect, it } from 'vitest';
import { normalizeSpiderRuntimeFailure } from '../src/engine/spider/spiderRuntimeFailure';
import { spiderCallFailed, spiderCallOutput, spiderCallSucceeded } from '../src/engine/spider/spiderCallResult';
import { SourceProblemError } from '../src/engine/spider/errors';
import { evaluateSpiderProcessExit } from '../src/engine/spider/spiderProcessOutcome';

const unsupportedRunnerErrors = [
  ['JVM', '[SpiderRunner.ERROR] java.lang.UnsupportedOperationException: WINBOX_OPERATION_UNSUPPORTED:searchContent'],
  ['Python', '[SpiderRunner.ERROR] _UnsupportedSpiderOperation: WINBOX_OPERATION_UNSUPPORTED:searchContent'],
] as const;

describe('shared spider runtime failure contract', () => {
  it.each(unsupportedRunnerErrors)('%s reports a missing operation through the same application error code', (_runtime, envelope) => {
    const failure = normalizeSpiderRuntimeFailure(envelope);
    expect(failure).toMatchObject({
      reason: '该源未提供搜索功能',
      problemCode: 'OPERATION_UNSUPPORTED',
    });

    let thrown: unknown;
    try {
      spiderCallOutput(spiderCallFailed('', failure.reason, failure.failureKind, failure.problemCode), 'profile/source', 'searchContent');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SourceProblemError);
    expect(thrown).toMatchObject({ code: 'OPERATION_UNSUPPORTED' });
  });

  it.each(unsupportedRunnerErrors)('%s process envelope keeps unsupported separate from generic runner errors', (_runtime, stderr) => {
    const outcome = evaluateSpiderProcessExit({
      stdout: '',
      stderr,
      exitCode: 1,
      timedOut: false,
      timeoutMs: 1000,
    });
    expect(outcome).toMatchObject({
      reason: '该源未提供搜索功能',
      problemCode: 'OPERATION_UNSUPPORTED',
    });
  });

  it('preserves a valid empty spider result as success', () => {
    const success = spiderCallSucceeded('');
    const timeout = spiderCallFailed('', '蜘蛛调用超时', null, 'SPIDER_TIMEOUT');

    expect(success).toMatchObject({ ok: true, output: '', problemCode: null });
    expect(timeout).toMatchObject({ ok: false, output: '', problemCode: 'SPIDER_TIMEOUT' });
    expect(spiderCallOutput(success, 'profile/source', 'playerContent')).toBe('');
    expect(() => spiderCallOutput(timeout, 'profile/source', 'searchContent')).toThrow(
      expect.objectContaining({ code: 'SPIDER_TIMEOUT' }),
    );

    expect(evaluateSpiderProcessExit({
      stdout: '""',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      timeoutMs: 1000,
    })).toMatchObject({ reason: '', problemCode: null });
  });
});
