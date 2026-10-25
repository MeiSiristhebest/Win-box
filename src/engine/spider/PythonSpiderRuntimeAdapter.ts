import { EmbeddedPythonRuntime, PYTHON_RUNTIME_VERSION } from './EmbeddedPythonRuntime';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SpiderProcPool, PoolResult } from './SpiderProcPool';
import { servePoolKey, WARM_METHOD } from './SpiderProcPool';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import { spiderCallFailed, spiderCallSucceeded, type SpiderCallResult } from './spiderCallResult';
import { normalizeSpiderRuntimeFailure } from './spiderRuntimeFailure';
import { SourceProblemError } from './errors';
import { abortError, throwIfAborted } from '../util/abort';
import { spiderPoolTimeoutResult } from './spiderPoolFailure';
import type { PythonSpiderRuntimePort } from './PythonSpiderRuntimePort';

type SpiderProxyProvider = () => { env: Record<string, string> };
type RunSubprocess = (
  executable: string,
  argv: string[],
  className: string,
  method: string,
  timeoutMs?: number,
  env?: Record<string, string>,
  signal?: AbortSignal,
) => Promise<SpiderCallResult>;
type SubmitToPool = (
  executable: string,
  key: string,
  serveArgv: string[],
  className: string,
  method: string,
  args: string[],
  env?: Record<string, string>,
  timeoutMs?: number,
  preferredPort?: number,
  signal?: AbortSignal,
) => Promise<PoolResult>;

export interface PythonSpiderRuntimeAdapterOptions {
  runtime: EmbeddedPythonRuntime;
  runtimeDir?: string;
  pool: SpiderProcPool | null;
  proxyProvider?: SpiderProxyProvider;
  logInfo(message: string): void;
  submitToPool: SubmitToPool;
  runSubprocess: RunSubprocess;
}

/** Owns embedded Python setup, warmup and invocation independently from JVM/JAR work. */
export class PythonSpiderRuntimeAdapter implements PythonSpiderRuntimePort {
  constructor(private readonly options: PythonSpiderRuntimeAdapterOptions) {}

  ensureRuntime(): Promise<string> {
    return this.options.runtime.ensure();
  }

  pyRuntimeReady(): boolean {
    return this.options.runtime.ready();
  }

  prewarmPythonRuntime(): Promise<string> {
    return this.ensureRuntime().catch(() => '');
  }

  prewarmPython(pyPath: string, className: string, count = 1, extend = '', sourceKey = ''): number {
    const { pool, runtimeDir, runtime, proxyProvider } = this.options;
    if (!pool || !runtimeDir) return 0;
    const dir = join(runtimeDir, PYTHON_RUNTIME_VERSION);
    const python = join(dir, 'python.exe');
    const runner = join(dir, 'runner.py');
    if (!this.pathExists(pyPath) || !this.pathExists(python) || !this.pathExists(runner) || !runtime.ready()) return 0;
    runtime.placeRunnerFiles(dir);
    const serveArgv = [runner, '-serve', pyPath, className];
    const env = {
      PYTHONIOENCODING: 'utf-8',
      ...proxyProvider?.().env,
      ...(sourceKey ? { WINBOX_PY_PROXY: `${LOCAL_PROXY_BASE}/proxy?do=py&key=${encodeURIComponent(sourceKey)}` } : {}),
    };
    const key = servePoolKey(python, serveArgv, env);
    return pool.warm(key, { exe: python, serveArgv, env, key }, count, { className, method: WARM_METHOD, args: [extend] });
  }

  async callPython(
    pyPath: string,
    className: string,
    method: string,
    args: string[],
    timeoutMs?: number,
    sourceKey = '',
    signal?: AbortSignal,
  ): Promise<SpiderCallResult> {
    throwIfAborted(signal);
    let runtimeDir: string;
    try {
      runtimeDir = await this.ensureRuntime();
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      throw new SourceProblemError(
        'PY_UNSUPPORTED',
        error instanceof Error ? error.message : String(error),
        { sourceKey, operation: method },
      );
    }
    throwIfAborted(signal);
    const executable = join(runtimeDir, 'python.exe');
    const runner = join(runtimeDir, 'runner.py');
    const argv = [runner, pyPath, className, method, ...args];
    const env = {
      PYTHONIOENCODING: 'utf-8',
      ...this.options.proxyProvider?.().env,
      ...(sourceKey ? { WINBOX_PY_PROXY: `${LOCAL_PROXY_BASE}/proxy?do=py&key=${encodeURIComponent(sourceKey)}` } : {}),
    };
    const requestTimeout = timeoutMs ?? 100000;

    if (this.options.pool) {
      const serveArgv = [runner, '-serve', pyPath, className];
      const key = servePoolKey(executable, serveArgv, env);
      try {
        const result = await this.options.submitToPool(executable, key, serveArgv, className, method, args, env, requestTimeout, undefined, signal);
        throwIfAborted(signal);
        if (result.ok) {
          const rawError = result.error ? String(result.error) : '';
          const failure = rawError ? normalizeSpiderRuntimeFailure(rawError) : null;
          if (rawError) this.options.logInfo(`python-bridge ${className}.${method} 失败原因: ${failure?.reason ?? ''}｜原始: ${rawError.slice(0, 300)}`);
          return failure
            ? spiderCallFailed(result.data, failure.reason, failure.failureKind, failure.problemCode)
            : spiderCallSucceeded(result.data);
        }
        const timeoutResult = spiderPoolTimeoutResult(result.reason, requestTimeout);
        if (timeoutResult) {
          this.options.logInfo(`python-bridge ${className}.${method} 失败原因: ${timeoutResult.reason}`);
          return timeoutResult;
        }
        if (result.reason === 'cancelled') throw signal ? abortError(signal) : new Error('搜索已取消');
      } catch {
        if (signal?.aborted) throw abortError(signal);
        // A pool transport failure falls back to a one-shot process. A successful
        // empty response is returned above and is never re-executed.
      }
    }

    throwIfAborted(signal);
    return this.options.runSubprocess(executable, argv, className, method, requestTimeout, env, signal);
  }

  private pathExists(path: string): boolean {
    return existsSync(path);
  }
}
