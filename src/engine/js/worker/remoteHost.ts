// src/engine/js/worker/remoteHost.ts
// worker 侧 JS 沙箱宿主端口：http 走消息往返；**同步** http/kv 走 SharedArrayBuffer + Atomics
// （worker 阻塞自己，主进程照常服务 —— 这正是修「同步 req 冻住整个软件」的关键）。
import type { MessagePort } from 'node:worker_threads';
import type { JsSandboxHostPort } from '../JsSandboxPort';
import type { HttpRequest, HttpResponse, KVStore, Logger } from '../../../shared/types';
import { SAB_HEADER, SAB_MAX_BYTES, waitForSabReply, type HostCall, type HostReply, type SabPayload } from './protocol';

/** 同步通道：写入请求 → Atomics.wait → 读回 JSON */
function sabRoundTrip<T>(port: MessagePort, make: (sab: SharedArrayBuffer) => HostCall, timeoutMs: number, seq: () => number): SabPayload<T> {
  const sab = new SharedArrayBuffer(SAB_HEADER + SAB_MAX_BYTES);
  const call = make(sab);
  (call as { id: number }).id = seq();
  try {
    port.postMessage(call);
  } catch (e) {
    return { ok: false, code: 'protocol', error: `同步通道投递失败: ${(e as Error).message}` };
  }
  return waitForSabReply<T>(sab, timeoutMs, '同步请求超时（主进程未及时响应）');
}

export interface RemoteHostOptions {
  jsLibDir: string;
  proxyBase: string;
}

/** Convert SAB transport failures into an explicit HTTP failure for legacy synchronous spider callers. */
export function responseForSabFailure(requestUrl: string, failure: SabPayload<unknown>): HttpResponse {
  const status = failure.code === 'oversized' ? 413 : failure.code === 'timeout' ? 504 : 502;
  return {
    status,
    headers: { 'x-winbox-sync-error-code': failure.code || 'protocol' },
    content: '',
    finalUrl: requestUrl,
  };
}

/**
 * 构造 worker 侧宿主。日志前缀由沙箱自身负责（`js:<key>` / `spider js:<key>`），这里原样转发。
 */
export function createRemoteHost(port: MessagePort, opts: RemoteHostOptions): JsSandboxHostPort {
  let seq = 0;
  const nextId = (): number => ++seq;
  const pending = new Map<number, { resolve: (r: HttpResponse) => void; reject: (e: Error) => void }>();

  port.on('message', (msg: HostReply) => {
    if (!msg || (msg.t !== 'httpRes' && msg.t !== 'httpErr')) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.t === 'httpRes') p.resolve(msg.res);
    else p.reject(new Error(msg.message));
  });

  const http = {
    request: (req: HttpRequest): Promise<HttpResponse> =>
      new Promise<HttpResponse>((resolve, reject) => {
        const id = nextId();
        pending.set(id, { resolve, reject });
        try {
          port.postMessage({ t: 'http', id, req } satisfies HostCall);
        } catch (e) {
          pending.delete(id);
          reject(e as Error);
        }
      }),
  };

  const logger: Logger = {
    i: (msg: string) => port.postMessage({ t: 'log', level: 'i', msg } satisfies HostCall),
    w: (msg: string) => port.postMessage({ t: 'log', level: 'w', msg } satisfies HostCall),
    e: (msg: string, err?: unknown) =>
      port.postMessage({ t: 'log', level: 'e', msg: err ? `${msg} | ${err instanceof Error ? err.stack ?? err.message : String(err)}` : msg } satisfies HostCall),
  };

  const kv: KVStore = {
    get: (key: string): string => {
      const r = sabRoundTrip<string>(port, (sab) => ({ t: 'kv', id: 0, op: 'get', key, sab } as HostCall), 5000, nextId);
      if (!r.ok) logger.w(`同步 KV 读取失败（${key.slice(0, 100)}）：${r.error || '未知原因'}`);
      return r.ok && typeof r.value === 'string' ? r.value : '';
    },
    set: (key: string, val: string): void => {
      const r = sabRoundTrip<string>(port, (sab) => ({ t: 'kv', id: 0, op: 'set', key, val, sab } as HostCall), 5000, nextId);
      if (!r.ok) logger.w(`同步 KV 写入失败（${key.slice(0, 100)}）：${r.error || '未知原因'}`);
    },
    delete: (key: string): void => {
      const r = sabRoundTrip<string>(port, (sab) => ({ t: 'kv', id: 0, op: 'delete', key, sab } as HostCall), 5000, nextId);
      if (!r.ok) logger.w(`同步 KV 删除失败（${key.slice(0, 100)}）：${r.error || '未知原因'}`);
    },
  };

  /**
   * 同步 HTTP —— worker 侧阻塞等待（`Atomics.wait`），主进程异步执行后写入 SAB。
   * 错误保持成明确的 HTTP 状态和诊断头，不把超大/超时响应伪装成空的 HTTP 200。
   */
  const httpSync = (req: HttpRequest): HttpResponse => {
    const budget = Math.min((req.timeoutMs ?? 10000) + 2000, 60_000);
    const r = sabRoundTrip<HttpResponse>(port, (sab) => ({ t: 'httpSync', id: 0, req, sab } as HostCall), budget, nextId);
    if (r.ok && r.value) return r.value;
    logger.w(`同步请求失败（${req.url.slice(0, 100)}）：${r.error || '未知原因'}`);
    return responseForSabFailure(req.url, r);
  };

  return { http, kv, logger, proxyBase: opts.proxyBase, jsLibDir: opts.jsLibDir, httpSync };
}
