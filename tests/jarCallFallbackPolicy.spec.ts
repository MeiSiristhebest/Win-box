import { describe, expect, it } from 'vitest';
import { spiderCallFailed, spiderCallSucceeded } from '../src/engine/spider/spiderCallResult';
import { decideJarCallFallback } from '../src/engine/spider/jarCallFallbackPolicy';

describe('JAR call fallback policy', () => {
  const failed = (failureKind: 'guard-inner-spider-null' | 'spider-class-missing' | null) =>
    spiderCallFailed('', 'original failure', failureKind, 'SPIDER_ERROR');

  it('returns completed output without probing fallback candidates', () => {
    const result = spiderCallSucceeded('valid empty-ish output');
    expect(decideJarCallFallback({
      firstAttempt: result,
      className: 'com.example.Spider',
      shellShimRetryAvailable: true,
      declaredEntryPresent: false,
      uniqueCandidates: ['other.jar'],
    })).toEqual({ type: 'return', result });
  });

  it('retries a guard failure through shell shim only when available', () => {
    const result = failed('guard-inner-spider-null');
    const base = { firstAttempt: result, className: 'com.example.Spider', declaredEntryPresent: false, uniqueCandidates: [] };
    expect(decideJarCallFallback({ ...base, shellShimRetryAvailable: true })).toEqual({ type: 'retry-shell-shim' });
    expect(decideJarCallFallback({ ...base, shellShimRetryAvailable: false })).toEqual({ type: 'return', result });
  });

  it('does not mix a cached build when the declared jar already contains the missing entry', () => {
    const result = failed('spider-class-missing');
    expect(decideJarCallFallback({
      firstAttempt: result,
      className: 'com.example.Spider',
      shellShimRetryAvailable: false,
      declaredEntryPresent: true,
      uniqueCandidates: ['other.jar'],
    })).toEqual({ type: 'return', result });
  });

  it('uses a sole candidate, rejects ambiguous candidates, and preserves the original result when none exists', () => {
    const result = failed('spider-class-missing');
    const input = { firstAttempt: result, className: 'com.example.Spider', shellShimRetryAvailable: false, declaredEntryPresent: false };
    expect(decideJarCallFallback({ ...input, uniqueCandidates: ['only.jar'] }))
      .toEqual({ type: 'retry-single-candidate', candidate: 'only.jar' });
    const ambiguous = decideJarCallFallback({ ...input, uniqueCandidates: ['one.jar', 'two.jar'] });
    expect(ambiguous.type).toBe('return');
    if (ambiguous.type === 'return') {
      expect(ambiguous.result.reason).toContain('2 个不同构建');
      expect(ambiguous.result.output).toBe(result.output);
      expect(ambiguous.result.problemCode).toBe(result.problemCode);
    }
    expect(decideJarCallFallback({ ...input, uniqueCandidates: [] })).toEqual({ type: 'return', result });
  });

  it('does not apply classpath fallback to unrelated failures', () => {
    const result = failed(null);
    expect(decideJarCallFallback({
      firstAttempt: result,
      className: 'com.example.Spider',
      shellShimRetryAvailable: true,
      declaredEntryPresent: false,
      uniqueCandidates: ['candidate.jar'],
    })).toEqual({ type: 'return', result });
  });
});
