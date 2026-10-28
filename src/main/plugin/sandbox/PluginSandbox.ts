// src/main/plugin/sandbox/PluginSandbox.ts
// L4 沙箱的**父进程侧单实例**：spawn worker + 等 ready/failed + 把 worker 的能力调用派发给宿主 API。
//
// ★ 每插件**一个独立 worker**（R10 拍板）：插件的代码/状态彼此隔离；崩溃只影响自己。
//   （引擎侧 `JsWorkerPool` 是「3 台共享 + 源粘性」的蜘蛛池，语义与本层不同 → 不复用其实例。）
//
// 事实源：docs/spec/R10-l4-sandbox-api/spec.md §6.2。

import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import type { PermissionId } from '../../../shared/plugin';
import { boundedJsonClone, type SpiderRuntimeContribute, type SpiderRuntimeOperation } from '../../../shared/plugin';
import { DEFAULT_SPIDER_TIMEOUT_MS } from '../../../engine/spider/Spider';
import type { Logger } from '../../../shared/types';
import type { HostCall, PluginSandboxApi, PluginWorkerData, PluginWorkerMessage, SpiderRuntimeHostRequest, SpiderRuntimeWorkerResult } from './protocol';
import type { PluginSandboxView } from '../../../shared/plugin';

/** 启动（加载脚本）超时 */
const START_TIMEOUT = 15_000;
const MAX_SPIDER_INPUT_BYTES = 256 * 1024;
const MAX_SPIDER_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_SPIDER_CALL_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_SPIDER_CALLS = 16;

export interface PluginWorkerPort {
  on(event: 'message', listener: (message: PluginWorkerMessage) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
}

export interface PluginSandboxOptions {
  pluginId: string;
  pluginDir: string;
  mainFile: string;
  permissions: readonly PermissionId[];
  spiderRuntimes?: readonly SpiderRuntimeContribute[];
  api: PluginSandboxApi;
  workerFile: string;
  logger: Logger;
  /** worker bundle 文本（可注入，便于单测；缺省惰性 readFileSync(workerFile)） */
  code?: string;
  /** Worker test seam; production uses the OS-managed worker_threads runtime. */
  workerFactory?: (code: string, data: PluginWorkerData) => PluginWorkerPort;
}

/** 管理器依赖的**最小沙箱面**（便于单测注入假件） */
export interface SandboxLike {
  start(): Promise<{ ok: boolean; error?: string }>;
  readonly running: boolean;
  readonly error: string | undefined;
  invokeSpider?(providerId: string, operation: SpiderRuntimeOperation, input: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown>;
  dispose(): void;
}

interface PendingSpiderCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class PluginSandbox implements SandboxLike {
  private worker: PluginWorkerPort | null = null;
  private readyOk = false;
  private stateError: string | undefined;
  private disposed = false;
  private codeCache = '';
  private spiderCallId = 1;
  private readonly pendingSpider = new Map<number, PendingSpiderCall>();

  constructor(private readonly opts: PluginSandboxOptions) {
    this.codeCache = opts.code ?? '';
  }

  get running(): boolean {
    return !!this.worker && this.readyOk;
  }

  get error(): string | undefined {
    return this.stateError;
  }

  /** 启动（spawn worker → 等 ready/failed）。**失败不抛**，返回 `{ ok, error? }`。 */
  start(): Promise<{ ok: boolean; error?: string }> {
    if (this.disposed) return Promise.resolve({ ok: false, error: '沙箱已释放' });
    if (this.worker) return Promise.resolve({ ok: this.readyOk, error: this.stateError });

    let code = this.codeCache;
    if (!code) {
      try {
        code = readFileSync(this.opts.workerFile, 'utf-8');
        this.codeCache = code;
      } catch (e) {
        const error = `沙箱 worker 产物缺失：${this.opts.workerFile}`;
        this.stateError = error;
        this.opts.logger.e(`插件沙箱启动失败（${this.opts.pluginId}）`, e);
        return Promise.resolve({ ok: false, error });
      }
    }

    const workerData: PluginWorkerData = {
      pluginId: this.opts.pluginId,
      pluginDir: this.opts.pluginDir,
      mainFile: this.opts.mainFile,
      permissions: [...this.opts.permissions],
      spiderRuntimes: this.opts.permissions.includes('spider.runtime') ? [...(this.opts.spiderRuntimes ?? [])] : [],
    };

    let w: PluginWorkerPort;
    try {
      w = this.opts.workerFactory
        ? this.opts.workerFactory(code, workerData)
        : new Worker(code, { eval: true, workerData, name: 'winbox-plugin' });
    } catch (e) {
      const error = `沙箱 worker 启动失败：${e instanceof Error ? e.message : String(e)}`;
      this.stateError = error;
      this.opts.logger.e(`插件沙箱启动失败（${this.opts.pluginId}）`, e);
      return Promise.resolve({ ok: false, error });
    }
    this.worker = w;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean, error?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.readyOk = ok;
        this.stateError = ok ? undefined : error;
        resolve({ ok, error });
      };
      const timer = setTimeout(() => {
        finish(false, `沙箱启动超时（>${START_TIMEOUT / 1000}s）`);
        void w.terminate();
        if (this.worker === w) this.worker = null;
      }, START_TIMEOUT);
      (timer as { unref?: () => void }).unref?.();

      w.on('message', (msg: PluginWorkerMessage) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'spider.result') {
          this.resolveSpiderCall(msg);
          return;
        }
        if (msg.t === 'ready') return finish(true);
        if (msg.t === 'failed') return finish(false, msg.message);
        void this.dispatch(w, msg);
      });
      w.on('error', (e: Error) => {
        this.opts.logger.e(`插件沙箱进程错误（${this.opts.pluginId}）`, e);
        finish(false, `沙箱进程错误：${e instanceof Error ? e.message : String(e)}`);
        this.rejectSpiderCalls(e);
        if (this.worker === w) this.worker = null;
      });
      w.on('exit', (c) => {
        if (this.disposed) return;
        if (this.worker === w) this.worker = null;
        if (c !== 0) {
          this.stateError = `沙箱进程退出（code=${c}）`;
          finish(false, this.stateError);
          this.rejectSpiderCalls(new Error(this.stateError));
        }
      });
    });
  }

  /** worker → 宿主能力调用：派发给 API，结果/错误按 id 回执 */
  private async dispatch(w: PluginWorkerPort, msg: HostCall): Promise<void> {
    const id = (msg as { id?: number }).id ?? -1;
    const reply = (ok: boolean, value?: unknown, error?: string): void => {
      try {
        w.postMessage({ t: 'reply', id, ok, value, error });
      } catch {
        /* worker 已终止：忽略 */
      }
    };
    const api = this.opts.api;
    const pid = this.opts.pluginId;
    try {
      switch (msg.t) {
        case 'log':
          api.log(pid, msg.level, msg.msg);
          return;
        case 'http':
          reply(true, await api.http(pid, msg.url, msg.opts));
          return;
        case 'download':
          reply(
            true,
            await api.download(pid, msg.url, msg.name, (loaded, total) => {
              try {
                w.postMessage({ t: 'progress', id: msg.id, loaded, total });
              } catch {
                /* ignore */
              }
            }),
          );
          return;
        case 'kv':
          reply(true, api.kv(pid, msg.op, msg.key, msg.val));
          return;
        case 'settings':
          reply(true, api.settings(pid, msg.op, msg.key, msg.val));
          return;
        case 'fs':
          reply(true, api.fs(pid, msg.op, msg.rel, msg.data));
          return;
        case 'notify':
          await api.notify(pid, msg.title, msg.body);
          reply(true);
          return;
        case 'clipboard':
          reply(true, await api.clipboard(pid, msg.op, msg.text));
          return;
        case 'dialog':
          reply(true, await api.dialog(pid, msg.op, msg.message, msg.title));
          return;
        case 'player':
          reply(true, await api.player(pid, msg.op, msg.value));
          return;
        case 'openExternal':
          await api.openExternal(pid, msg.url);
          reply(true);
          return;
        default:
          return;
      }
    } catch (e) {
      reply(false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  /** Host-initiated, bounded request/reply path for a manifest-declared Spider operation. */
  invokeSpider(
    providerId: string,
    operation: SpiderRuntimeOperation,
    input: unknown,
    timeoutMs = DEFAULT_SPIDER_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.opts.permissions.includes('spider.runtime')) return Promise.reject(new Error('插件未获 spider.runtime 授权'));
    const provider = (this.opts.spiderRuntimes ?? []).find((item) => item.id === providerId);
    if (!provider || !provider.operations.includes(operation)) return Promise.reject(new Error('Spider provider 或操作未授权'));
    if (!this.running || !this.worker) return Promise.reject(new Error(`插件 Spider worker 未运行：${this.stateError || 'not ready'}`));
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    if (this.pendingSpider.size >= MAX_CONCURRENT_SPIDER_CALLS) return Promise.reject(new Error('插件 Spider 并发调用已达上限'));

    let safeInput: unknown;
    try {
      safeInput = boundedJsonClone(input, MAX_SPIDER_INPUT_BYTES);
    } catch (error) {
      return Promise.reject(error);
    }

    const id = this.spiderCallId++;
    const budget = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(MAX_SPIDER_CALL_TIMEOUT_MS, Math.floor(timeoutMs))
      : DEFAULT_SPIDER_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancelSpiderCall(id, new Error(`插件 Spider 调用超时（>${budget}ms）`), true), budget);
      (timer as { unref?: () => void }).unref?.();
      const pending: PendingSpiderCall = { resolve, reject, timer, signal };
      if (signal) {
        pending.onAbort = () => this.cancelSpiderCall(id, abortError(signal.reason), true);
        signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      this.pendingSpider.set(id, pending);
      try {
        this.worker?.postMessage({ t: 'spider.invoke', id, providerId, operation, input: safeInput } satisfies SpiderRuntimeHostRequest);
      } catch (error) {
        this.cancelSpiderCall(id, error instanceof Error ? error : new Error(String(error)), false);
      }
    });
  }

  private resolveSpiderCall(result: SpiderRuntimeWorkerResult): void {
    const pending = this.pendingSpider.get(result.id);
    if (!pending) return;
    this.pendingSpider.delete(result.id);
    this.cleanupSpiderCall(pending);
    if (!result.ok) {
      pending.reject(new Error(result.error || '插件 Spider 调用失败'));
      return;
    }
    try {
      pending.resolve(boundedJsonClone(result.value, MAX_SPIDER_RESULT_BYTES));
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private cancelSpiderCall(id: number, error: Error, notifyWorker: boolean): void {
    const pending = this.pendingSpider.get(id);
    if (!pending) return;
    this.pendingSpider.delete(id);
    this.cleanupSpiderCall(pending);
    if (notifyWorker) {
      try {
        this.worker?.postMessage({ t: 'spider.cancel', id } satisfies SpiderRuntimeHostRequest);
      } catch {
        /* worker already stopped */
      }
    }
    pending.reject(error);
  }

  private cleanupSpiderCall(pending: PendingSpiderCall): void {
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort);
  }

  private rejectSpiderCalls(error: Error): void {
    for (const id of this.pendingSpider.keys()) this.cancelSpiderCall(id, error, false);
  }

  dispose(): void {
    this.disposed = true;
    this.readyOk = false;
    const w = this.worker;
    for (const id of this.pendingSpider.keys()) this.cancelSpiderCall(id, new Error('插件 Spider worker 已释放'), true);
    this.worker = null;
    if (w) void w.terminate();
  }

  /** 运行态视图（供 `PluginView.sandbox`） */
  view(): PluginSandboxView {
    return { running: this.running, error: this.stateError };
  }
}

function abortError(reason: unknown): Error {
  const error = new Error(reason instanceof Error ? reason.message : reason == null ? 'Spider call aborted' : String(reason));
  error.name = 'AbortError';
  return error;
}
