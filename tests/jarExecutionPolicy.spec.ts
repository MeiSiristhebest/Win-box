import { describe, expect, it, vi } from 'vitest';
import { LOCAL_PROXY_BASE } from '../src/shared/constants';
import { JarSpiderBridge, NATIVE_CALL_MIN_TIMEOUT_MS } from '../src/engine/spider/JarSpiderBridge';
import { spiderProxyPort } from '../src/engine/spider/jarBridgePolicy';
import type { SpiderProcPool } from '../src/engine/spider/SpiderProcPool';
import {
  buildJarCallArgv,
  buildJarJvmPrefix,
  buildJarServeArgv,
  createJarExecutionLaunchPlan,
  jarPoolFailureAction,
} from '../src/engine/spider/jarExecutionPolicy';

describe('JAR execution policy', () => {
  const loaderClasspath = 'C:/cache/shell-shim.jar;C:/cache/site.jar';

  it('builds a stable one-shot JVM prefix with loader-specific proxy identity', () => {
    const proxyPort = spiderProxyPort(loaderClasspath);
    expect(buildJarJvmPrefix({
      runtimeClasspath: 'C:/runtime/stubs.jar;C:/runtime/native.jar',
      loaderClasspath,
      serve: false,
      sandboxDirectory: 'C:/data/sandbox',
      javaExecutable: 'C:/jre/bin/java.exe',
      dex2jarClasspath: 'C:/jvm/d2j/d2j.jar',
      dex2jarCacheDirectory: 'C:/data/runtime-dex',
      proxyJvmArgs: ['-Dhttp.proxyHost=localhost'],
    })).toEqual([
      '-noverify',
      '-Xmx256m',
      '-XX:+UseSerialGC',
      '-Dtvbox.spiderCacheDir=C:/data/sandbox',
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
      '-Dfile.encoding=UTF-8',
      '-Dsun.stdout.encoding=UTF-8',
      '-Dsun.stderr.encoding=UTF-8',
      '-Dhttp.proxyHost=localhost',
      `-Dtvbox.proxy.port=${proxyPort}`,
      `-Dtvbox.proxy.entry=${LOCAL_PROXY_BASE}/proxy/${proxyPort}`,
      '-Dtvbox.d2j.java=C:/jre/bin/java.exe',
      '-Dtvbox.d2j.cp=C:/jvm/d2j/d2j.jar',
      '-Dtvbox.d2j.cache=C:/data/runtime-dex',
      '-cp',
      'C:/runtime/stubs.jar;C:/runtime/native.jar',
    ]);
  });

  it('uses the serve heap and preserves shim/native/runner argument order', () => {
    const prefix = buildJarJvmPrefix({
      runtimeClasspath: 'runtime.jar',
      loaderClasspath,
      serve: true,
      sandboxDirectory: 'sandbox',
      javaExecutable: 'java.exe',
      dex2jarClasspath: 'd2j.jar',
      dex2jarCacheDirectory: 'runtime-dex',
    });
    expect(prefix[1]).toBe('-Xmx384m');

    const shim = 'C:/shell/real-implementation';
    const nativeArguments = ['-Dtvbox.native.root=C:/native'];
    expect(buildJarServeArgv({ jvmPrefix: prefix, loaderClasspath, shimClasses: shim, nativeArguments })).toEqual([
      ...prefix,
      `-Dtvbox.shellShimClasses=${shim}`,
      ...nativeArguments,
      'SpiderRunner', '--serve', loaderClasspath,
    ]);
    expect(buildJarCallArgv({
      jvmPrefix: prefix,
      loaderClasspath,
      shimClasses: shim,
      nativeArguments,
      className: 'com.example.Spider',
      method: 'homeContent',
      args: ['ext', 'filter'],
    })).toEqual([
      ...prefix,
      `-Dtvbox.shellShimClasses=${shim}`,
      ...nativeArguments,
      'SpiderRunner', loaderClasspath, 'com.example.Spider', 'homeContent', 'ext', 'filter',
    ]);
  });

  it('keeps runtime and isolated spider classpaths separate for invocation and prewarm', () => {
    const plan = createJarExecutionLaunchPlan({
      classpaths: {
        runtimeJars: ['stubs.jar;libs.jar'],
        nativeJars: ['bridge.jar', 'unidbg.jar'],
        spiderJars: ['site-a.jar', 'site-b.jar'],
        shimClasses: 'C:/real-spider',
        shimJar: { path: 'shell-shim.jar', available: true },
      },
      nativeArguments: ['-Dtvbox.native.root=C:/native'],
    });
    expect(plan.runtimeClasspath).toBe('stubs.jar;libs.jar;bridge.jar;unidbg.jar');
    expect(plan.loaderClasspath).toBe('shell-shim.jar;site-a.jar;site-b.jar');

    const prefix = ['-cp', plan.runtimeClasspath];
    expect(plan.serveArgv(prefix)).toEqual([
      ...prefix,
      '-Dtvbox.shellShimClasses=C:/real-spider',
      '-Dtvbox.native.root=C:/native',
      'SpiderRunner', '--serve', 'shell-shim.jar;site-a.jar;site-b.jar',
    ]);
    expect(plan.oneShotArgv(prefix, { className: 'com.example.Spider', method: 'homeContent', args: ['ext'] })).toEqual([
      ...prefix,
      '-Dtvbox.shellShimClasses=C:/real-spider',
      '-Dtvbox.native.root=C:/native',
      'SpiderRunner', 'shell-shim.jar;site-a.jar;site-b.jar', 'com.example.Spider', 'homeContent', 'ext',
    ]);
  });

  it('does not add a missing or unconfigured shell shim to the loader classpath', () => {
    expect(createJarExecutionLaunchPlan({
      classpaths: {
        runtimeJars: ['runtime.jar'],
        nativeJars: [],
        spiderJars: ['site.jar'],
        shimClasses: 'C:/real-spider',
        shimJar: { path: 'missing-shell-shim.jar', available: false },
      },
      nativeArguments: [],
    }).loaderClasspath).toBe('site.jar');

    expect(createJarExecutionLaunchPlan({
      classpaths: {
        runtimeJars: ['runtime.jar'],
        nativeJars: [],
        spiderJars: ['site.jar'],
        shimJar: { path: 'shell-shim.jar', available: true },
      },
      nativeArguments: [],
    }).loaderClasspath).toBe('site.jar');
  });

  it.each([
    ['timeout', 'return-timeout'],
    ['queue-timeout', 'return-timeout'],
    ['capacity-exhausted', 'return-capacity'],
    ['output-limit', 'return-output-limit'],
    ['cancelled', 'throw-cancelled'],
    ['exit', 'fallback-one-shot'],
    ['spawn-error', 'fallback-one-shot'],
    ['stdin', 'fallback-one-shot'],
    ['lru', 'fallback-one-shot'],
    ['idle', 'fallback-one-shot'],
    ['dispose', 'fallback-one-shot'],
    [undefined, 'fallback-one-shot'],
  ] as const)('classifies pool reason %s as %s', (reason, expected) => {
    expect(jarPoolFailureAction(reason)).toBe(expected);
  });

  it('does not turn a pool cancellation into a one-shot JVM launch', async () => {
    const oneShotRun = vi.fn();
    const bridge = Object.create(JarSpiderBridge.prototype) as unknown as {
      callImpl: (jars: string[], className: string, method: string, args: string[]) => Promise<unknown>;
      shellCompatibility: {
        classesPath: () => string;
        resolveForJars: () => string;
        includeFoniImplementation: () => string;
        shimJarPath: () => string;
      };
      shimPreferred: Set<string>;
      nativeNeeded: () => boolean;
      classpathJars: () => string;
      nativeProps: () => string[];
      jvmPrefix: (classpath: string, serve: boolean, loaderClasspath: string) => string[];
      javaExe: () => string;
      callTimeoutMs: number;
      pool: SpiderProcPool;
      poolSubmit: () => Promise<{ ok: false; data: string; reason: 'cancelled' }>;
      proxyPortKeys: Map<number, string>;
      detailProxyPortByTag: Map<string, number>;
      proxyPortByTag: Map<string, number>;
      subprocessRunner: { run: typeof oneShotRun };
    };
    Object.assign(bridge, {
      shellCompatibility: {
        classesPath: () => '',
        resolveForJars: () => '',
        includeFoniImplementation: () => '',
        shimJarPath: () => 'shim.jar',
      },
      shimPreferred: new Set<string>(),
      nativeNeeded: () => false,
      classpathJars: () => 'runtime.jar',
      nativeProps: () => [],
      jvmPrefix: vi.fn((classpath: string) => ['-cp', classpath]),
      javaExe: () => 'java.exe',
      callTimeoutMs: 1000,
      pool: { pin: vi.fn() } as unknown as SpiderProcPool,
      poolSubmit: async () => ({ ok: false, data: '', reason: 'cancelled' as const }),
      proxyPortKeys: new Map<number, string>(),
      detailProxyPortByTag: new Map<string, number>(),
      proxyPortByTag: new Map<string, number>(),
      subprocessRunner: { run: oneShotRun },
    });

    await expect(bridge.callImpl([loaderClasspath], 'com.example.Spider', 'homeContent', []))
      .rejects.toThrow('搜索已取消');
    expect(oneShotRun).not.toHaveBeenCalled();
  });

  it('does not build or probe a serve JVM prefix when the process pool is disabled', async () => {
    const oneShotRun = vi.fn(async () => ({ output: 'ok', reason: '' }));
    const jvmPrefix = vi.fn((classpath: string, serve: boolean) => {
      if (serve) throw new Error('serve prefix must remain lazy when pooling is disabled');
      return ['-cp', classpath];
    });
    const bridge = Object.create(JarSpiderBridge.prototype) as unknown as {
      callImpl: (jars: string[], className: string, method: string, args: string[]) => Promise<unknown>;
      shellCompatibility: {
        classesPath: () => string;
        resolveForJars: () => string;
        includeFoniImplementation: () => string;
        shimJarPath: () => string;
      };
      shimPreferred: Set<string>;
      nativeNeeded: () => boolean;
      classpathJars: () => string;
      nativeProps: () => string[];
      jvmPrefix: typeof jvmPrefix;
      javaExe: () => string;
      callTimeoutMs: number;
      pool: null;
      processAdmission: { tryAcquireFallbackProcessSlot: () => () => void };
      subprocessRunner: { run: typeof oneShotRun };
    };
    Object.assign(bridge, {
      shellCompatibility: {
        classesPath: () => '',
        resolveForJars: () => '',
        includeFoniImplementation: () => '',
        shimJarPath: () => 'shim.jar',
      },
      shimPreferred: new Set<string>(),
      nativeNeeded: () => false,
      classpathJars: () => 'runtime.jar',
      nativeProps: () => [],
      jvmPrefix,
      javaExe: () => 'java.exe',
      callTimeoutMs: 1000,
      pool: null,
      processAdmission: { tryAcquireFallbackProcessSlot: () => () => undefined },
      subprocessRunner: { run: oneShotRun },
    });

    await expect(bridge.callImpl(['site.jar'], 'com.example.Spider', 'homeContent', []))
      .resolves.toEqual({ output: 'ok', reason: '' });

    expect(jvmPrefix).toHaveBeenCalledOnce();
    expect(jvmPrefix).toHaveBeenCalledWith('runtime.jar', false, 'site.jar');
    expect(oneShotRun).toHaveBeenCalledOnce();
  });

  it('preserves the native-call timeout when a pooled transport failure falls back to one-shot', async () => {
    const oneShotFallback = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      output: 'recovered',
      reason: '',
      failureKind: null,
      problemCode: null,
    }));
    const bridge = Object.create(JarSpiderBridge.prototype) as unknown as {
      callImpl: (jars: string[], className: string, method: string, args: string[]) => Promise<unknown>;
      shellCompatibility: {
        classesPath: () => string;
        resolveForJars: () => string;
        includeFoniImplementation: () => string;
        shimJarPath: () => string;
      };
      shimPreferred: Set<string>;
      nativeNeeded: () => boolean;
      ensureNativeRuntime: () => Promise<string[]>;
      nativeProps: () => string[];
      classpathJars: () => string;
      jvmPrefix: (classpath: string, serve: boolean, loaderClasspath: string) => string[];
      javaExe: () => string;
      callTimeoutMs: number;
      pool: SpiderProcPool;
      poolSubmit: (...args: unknown[]) => Promise<{ ok: false; data: string; reason: 'exit' }>;
      processAdmission: { tryAcquireFallbackProcessSlot: () => () => void };
      proxyPortKeys: Map<number, string>;
      detailProxyPortByTag: Map<string, number>;
      proxyPortByTag: Map<string, number>;
      runSubprocessWithinProcessBudget: (...args: unknown[]) => Promise<unknown>;
    };
    const poolSubmit = vi.fn(async (..._args: unknown[]) => ({ ok: false as const, data: '', reason: 'exit' as const }));
    const runSubprocessWithinProcessBudget = vi.fn(async (...args: unknown[]) => oneShotFallback(...args));
    Object.assign(bridge, {
      shellCompatibility: {
        classesPath: () => '',
        resolveForJars: () => '',
        includeFoniImplementation: () => '',
        shimJarPath: () => 'shim.jar',
      },
      shimPreferred: new Set<string>(),
      nativeNeeded: () => true,
      ensureNativeRuntime: async () => ['native-bridge.jar'],
      nativeProps: () => [],
      classpathJars: () => 'runtime.jar',
      jvmPrefix: (classpath: string) => ['-cp', classpath],
      javaExe: () => 'java.exe',
      callTimeoutMs: 1000,
      pool: { pin: vi.fn() } as unknown as SpiderProcPool,
      poolSubmit,
      processAdmission: { tryAcquireFallbackProcessSlot: () => () => undefined },
      proxyPortKeys: new Map<number, string>(),
      detailProxyPortByTag: new Map<string, number>(),
      proxyPortByTag: new Map<string, number>(),
      runSubprocessWithinProcessBudget,
    });

    await expect(bridge.callImpl(['site.jar'], 'com.example.Spider', 'playerContent', []))
      .resolves.toMatchObject({ ok: true, output: 'recovered' });

    expect(poolSubmit.mock.calls[0]?.[7]).toBe(NATIVE_CALL_MIN_TIMEOUT_MS);
    expect(runSubprocessWithinProcessBudget.mock.calls[0]?.[4]).toBe(NATIVE_CALL_MIN_TIMEOUT_MS);
  });
});
