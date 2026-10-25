import { SourceProblemError } from './errors';
import type { SourceProblemCode } from './errors';
import type { SpiderFailureKind } from './spiderDiagnostics';

/** Diagnostics belong to the invocation that produced them, including legal empty output. */
export type SpiderCallResult =
  | {
      ok: true;
      output: string;
      reason: '';
      failureKind: null;
      problemCode: null;
    }
  | {
      ok: false;
      output: string;
      reason: string;
      failureKind: SpiderFailureKind | null;
      /** Application-facing class; separate from failureKind, which drives JVM retry policy. */
      problemCode: SourceProblemCode;
    };

export function spiderCallSucceeded(output: string): SpiderCallResult {
  return { ok: true, output, reason: '', failureKind: null, problemCode: null };
}

export function spiderCallFailed(
  output: string,
  reason: string,
  failureKind: SpiderFailureKind | null,
  problemCode: SourceProblemCode,
): SpiderCallResult {
  return { ok: false, output, reason, failureKind, problemCode };
}

/** Maps a runtime failure at the adapter boundary without reading shared diagnostic state. */
export function spiderCallOutput(result: SpiderCallResult, sourceKey: string, method: string): string {
  if (!result.ok) {
    throw new SourceProblemError(result.problemCode, result.reason, {
      sourceKey,
      operation: method,
      failureKind: result.failureKind,
    });
  }
  return result.output;
}
