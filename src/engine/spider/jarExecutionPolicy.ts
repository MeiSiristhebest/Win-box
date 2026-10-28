import { LOCAL_PROXY_BASE } from '../../shared/constants';
import { spiderProxyPort } from './jarBridgePolicy';
import { spiderCallFailed, spiderCallSucceeded, type SpiderCallResult } from './spiderCallResult';
import { normalizeSpiderRuntimeFailure } from './spiderRuntimeFailure';
import { spiderPoolCapacityResult, spiderPoolOutputLimitResult, spiderPoolTimeoutResult } from './spiderPoolFailure';

/** Values needed to describe a JVM launch; collecting them has no I/O or process side effects. */
export interface JarJvmPrefixInput {
  runtimeClasspath: string;
  loaderClasspath: string;
  serve: boolean;
  sandboxDirectory: string;
  javaExecutable: string;
  dex2jarClasspath: string;
  dex2jarCacheDirectory: string;
  proxyJvmArgs?: readonly string[];
}

export interface JarExecutionClasspathInput {
  /** Parent classpath containing only the runner and its runtime libraries. */
  runtimeJars: readonly string[];
  /** Optional native bridge libraries belong to the parent, ahead of no spider classes. */
  nativeJars: readonly string[];
  /** Spider artifacts are loaded by SpiderRunner's isolated child loader. */
  spiderJars: readonly string[];
  /** The shell compatibility implementation path, when one is configured. */
  shimClasses?: string;
  /** Whether the shadow shim jar exists at the adapter boundary. */
  shimJar?: { path: string; available: boolean };
}

export interface JarExecutionClasspaths {
  runtimeClasspath: string;
  loaderClasspath: string;
}

export interface JarInvocationRequest {
  className: string;
  method: string;
  args: readonly string[];
}

export interface JarExecutionLaunchPlan extends JarExecutionClasspaths {
  /** Build the cold runner invocation without probing or constructing a serve JVM. */
  oneShotArgv(jvmPrefix: readonly string[], request: JarInvocationRequest): string[];
  /** Build the pooled runner invocation only when the caller actually enables the pool. */
  serveArgv(jvmPrefix: readonly string[]): string[];
}

/**
 * Keep the JVM parent classpath and the spider child-loader classpath separate.
 * The optional shell shim must precede the spider jars so its compatibility
 * classes win, while native bridge jars stay on the parent classpath only.
 */
export function buildJarExecutionClasspaths(input: JarExecutionClasspathInput): JarExecutionClasspaths {
  const loaderJars = [
    ...(input.shimClasses && input.shimJar?.available ? [input.shimJar.path] : []),
    ...input.spiderJars,
  ];
  return {
    runtimeClasspath: [...input.runtimeJars, ...input.nativeJars].join(';'),
    loaderClasspath: loaderJars.join(';'),
  };
}

/**
 * Creates the immutable classpath/argv plan shared by pool warmup and live calls.
 * JVM prefixes remain adapter supplied so a pool-disabled caller never performs
 * serve-only JVM discovery or setup work.
 */
export function createJarExecutionLaunchPlan(input: {
  classpaths: JarExecutionClasspathInput;
  nativeArguments: readonly string[];
}): JarExecutionLaunchPlan {
  const classpaths = buildJarExecutionClasspaths(input.classpaths);
  const shimClasses = input.classpaths.shimClasses ?? '';
  const nativeArguments = [...input.nativeArguments];
  return {
    ...classpaths,
    oneShotArgv: (jvmPrefix, request) => buildJarCallArgv({
      jvmPrefix,
      loaderClasspath: classpaths.loaderClasspath,
      shimClasses,
      nativeArguments,
      ...request,
    }),
    serveArgv: (jvmPrefix) => buildJarServeArgv({
      jvmPrefix,
      loaderClasspath: classpaths.loaderClasspath,
      shimClasses,
      nativeArguments,
    }),
  };
}

const MODULE_OPEN_ARGUMENTS = [
  '--add-opens=java.base/java.lang=ALL-UNNAMED',
  '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED',
  '--add-opens=java.base/java.lang.invoke=ALL-UNNAMED',
  '--add-opens=java.base/java.util=ALL-UNNAMED',
  '--add-opens=java.base/java.util.concurrent=ALL-UNNAMED',
  '--add-opens=java.base/java.io=ALL-UNNAMED',
  '--add-opens=java.base/java.net=ALL-UNNAMED',
  '--add-opens=java.base/java.nio=ALL-UNNAMED',
  '--add-opens=java.base/java.security=ALL-UNNAMED',
  '--add-opens=java.base/java.text=ALL-UNNAMED',
  '--add-opens=java.base/sun.net.www.protocol.jar=ALL-UNNAMED',
] as const;

/** Build JVM arguments in the established order, including the loader-specific proxy identity. */
export function buildJarJvmPrefix(input: JarJvmPrefixInput): string[] {
  const proxyPort = spiderProxyPort(input.loaderClasspath);
  return [
    '-noverify',
    input.serve ? '-Xmx384m' : '-Xmx256m',
    '-XX:+UseSerialGC',
    `-Dtvbox.spiderCacheDir=${input.sandboxDirectory}`,
    ...MODULE_OPEN_ARGUMENTS,
    '-Dfile.encoding=UTF-8',
    '-Dsun.stdout.encoding=UTF-8',
    '-Dsun.stderr.encoding=UTF-8',
    ...(input.proxyJvmArgs ?? []),
    `-Dtvbox.proxy.port=${proxyPort}`,
    `-Dtvbox.proxy.entry=${LOCAL_PROXY_BASE}/proxy/${proxyPort}`,
    `-Dtvbox.d2j.java=${input.javaExecutable}`,
    `-Dtvbox.d2j.cp=${input.dex2jarClasspath}`,
    `-Dtvbox.d2j.cache=${input.dex2jarCacheDirectory}`,
    '-cp', input.runtimeClasspath,
  ];
}

export interface JarServeArgvInput {
  jvmPrefix: readonly string[];
  loaderClasspath: string;
  shimClasses?: string;
  nativeArguments: readonly string[];
}

export function buildJarServeArgv(input: JarServeArgvInput): string[] {
  return [
    ...input.jvmPrefix,
    ...(input.shimClasses ? [`-Dtvbox.shellShimClasses=${input.shimClasses}`] : []),
    ...input.nativeArguments,
    'SpiderRunner', '--serve', input.loaderClasspath,
  ];
}

export interface JarCallArgvInput extends JarServeArgvInput {
  className: string;
  method: string;
  args: readonly string[];
}

export function buildJarCallArgv(input: JarCallArgvInput): string[] {
  return [
    ...input.jvmPrefix,
    ...(input.shimClasses ? [`-Dtvbox.shellShimClasses=${input.shimClasses}`] : []),
    ...input.nativeArguments,
    'SpiderRunner', input.loaderClasspath, input.className, input.method, ...input.args,
  ];
}

export type JarPoolFailureAction =
  | 'return-timeout'
  | 'return-capacity'
  | 'return-output-limit'
  | 'throw-cancelled'
  | 'fallback-one-shot';

/** Only transport failures may start a cold process; completed failures and cancellation are terminal. */
export function jarPoolFailureAction(reason: string | undefined): JarPoolFailureAction {
  switch (reason) {
    case 'timeout':
    case 'queue-timeout':
      return 'return-timeout';
    case 'capacity-exhausted':
      return 'return-capacity';
    case 'output-limit':
      return 'return-output-limit';
    case 'cancelled':
      return 'throw-cancelled';
    default:
      return 'fallback-one-shot';
  }
}

export interface JarPoolCallResultInput {
  ok: boolean;
  data: string;
  reason?: string;
  error?: string;
  timeoutMs: number;
}

export type JarPoolCallResultDecision =
  | { type: 'completed'; result: SpiderCallResult; runtimeError?: { reason: string; raw: string } }
  | { type: 'cancelled' }
  | { type: 'retry-one-shot' };

/**
 * Translate a pooled JVM response into the caller-visible outcome. This keeps
 * the retry boundary explicit: completed spider errors, timeouts, capacity
 * pressure, malformed output, and cancellation never start a duplicate JVM.
 */
export function decideJarPoolCallResult(input: JarPoolCallResultInput): JarPoolCallResultDecision {
  if (input.ok) {
    const rawError = input.error ? String(input.error) : '';
    const runtimeFailure = rawError ? normalizeSpiderRuntimeFailure(rawError) : null;
    return {
      type: 'completed',
      result: runtimeFailure
        ? spiderCallFailed(input.data, runtimeFailure.reason, runtimeFailure.failureKind, runtimeFailure.problemCode)
        : spiderCallSucceeded(input.data),
      ...(rawError ? { runtimeError: { reason: runtimeFailure?.reason ?? '', raw: rawError } } : {}),
    };
  }

  switch (jarPoolFailureAction(input.reason)) {
    case 'return-timeout': {
      const result = spiderPoolTimeoutResult(input.reason, input.timeoutMs);
      return result ? { type: 'completed', result } : { type: 'retry-one-shot' };
    }
    case 'return-capacity': {
      const result = spiderPoolCapacityResult(input.reason);
      return result ? { type: 'completed', result } : { type: 'retry-one-shot' };
    }
    case 'return-output-limit': {
      const result = spiderPoolOutputLimitResult(input.reason);
      return result ? { type: 'completed', result } : { type: 'retry-one-shot' };
    }
    case 'throw-cancelled':
      return { type: 'cancelled' };
    case 'fallback-one-shot':
      return { type: 'retry-one-shot' };
  }
}
