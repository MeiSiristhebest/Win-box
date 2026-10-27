import type { SpiderCallResult } from './spiderCallResult';

export type JarCallFallbackDecision =
  | { type: 'return'; result: SpiderCallResult }
  | { type: 'retry-shell-shim' }
  | { type: 'retry-single-candidate'; candidate: string };

export interface JarCallFallbackPolicyInput {
  firstAttempt: SpiderCallResult;
  className: string;
  shellShimRetryAvailable: boolean;
  declaredEntryPresent: boolean;
  uniqueCandidates: readonly string[];
}

/**
 * Select a safe recovery path after one JAR invocation. The decision is pure:
 * filesystem/classpath discovery is supplied by the runtime adapter, while the
 * policy remains testable without opening archives or starting a JVM.
 */
export function decideJarCallFallback({
  firstAttempt,
  className,
  shellShimRetryAvailable,
  declaredEntryPresent,
  uniqueCandidates,
}: JarCallFallbackPolicyInput): JarCallFallbackDecision {
  if (firstAttempt.output.trim() && !firstAttempt.reason) return { type: 'return', result: firstAttempt };

  if (firstAttempt.failureKind === 'guard-inner-spider-null' && shellShimRetryAvailable) {
    return { type: 'retry-shell-shim' };
  }

  if (firstAttempt.failureKind !== 'spider-class-missing' || declaredEntryPresent) {
    return { type: 'return', result: firstAttempt };
  }

  if (uniqueCandidates.length > 1) {
    return {
      type: 'return',
      result: {
        ...firstAttempt,
        reason: `蜘蛛类未找到；缓存中有 ${uniqueCandidates.length} 个不同构建包含 ${className}，无法安全选择，请修正源 jar 配置`,
      },
    };
  }

  if (uniqueCandidates.length === 1) {
    return { type: 'retry-single-candidate', candidate: uniqueCandidates[0] };
  }

  return { type: 'return', result: firstAttempt };
}
