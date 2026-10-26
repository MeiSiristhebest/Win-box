// src/engine/js/worker/protocol.ts
// ★★ 2026-09-30（用户报「另一台设备用自用本地包搜索时软件卡死」）★☆
//   JS 蜘蛛（drpy/hiker）此前跑在**主进程内**（node:vm）。而同步 `req()` 是用
//   `spawnSync` 实现的 —— 它同步阻塞主进程：实测单个源连续同步请求每次冻住 400ms~1.5s，
//   指向本机回环（`/pkg/…` 等自家本地代理路由）时更会与主进程**互等死锁**（实测 11.6s，
//   日志里 `97_search.js` 之后整整 62s 无任何日志 = 软件假死）。
//   修法：把 JS 沙箱整体搬进 **worker_threads**，同步阻塞只卡 worker；宿主能力（http/kv/logger）
//   经本协议回主进程执行（http 走消息往返，kv/同步 http 走 SharedArrayBuffer + Atomics，
//   让 worker 能保持真同步语义而不冻主进程）。
//
// 约定：`sab` 通道的数据布局 = [0]=状态(0 未就绪/1 完成, Int32) [1]=字节长度(Int32) [8..]=UTF-8 JSON。

import type { HttpRequest, HttpResponse } from '../../../shared/types';
import type { SourceProblemCode } from '../../spider/errors';

/** SAB 数据区起点（前 8 字节是两个 Int32 控制位） */
export const SAB_HEADER = 8;
/** 单次同步往返的最大载荷；超出时返回明确错误，绝不截断 JSON。 */
export const SAB_MAX_BYTES = 8 * 1024 * 1024;

const SAB_PENDING = 0;
const SAB_WRITING = 1;
const SAB_READY = 2;
const SAB_OVERSIZED = 3;
const SAB_SERIALIZATION_ERROR = 4;

/** worker → 主进程（宿主调用） */
export type HostCall =
  | { t: 'http'; id: number; req: HttpRequest }
  | { t: 'httpSync'; id: number; req: HttpRequest; sab: SharedArrayBuffer }
  | { t: 'kv'; id: number; op: 'get' | 'set' | 'delete'; key: string; val?: string; sab: SharedArrayBuffer }
  | { t: 'log'; level: 'i' | 'w' | 'e'; msg: string };

/** 主进程 → worker（任务） */
export type WorkerTask =
  // ★ open 也带 id：脚本加载/init 失败必须**立刻回执**（否则池只能等 OPEN_TIMEOUT 杀 worker 重来，
  //   表现为「JS 源连环打开超时」）—— 与 call 共用 pending 回执通道。
  | { t: 'open'; id: number; key: string; api: string; ext: string }
  | { t: 'setExt'; key: string; ext: string }
  | { t: 'call'; id: number; key: string; names: string[]; args: unknown[]; timeoutMs: number }
  | { t: 'destroy'; key: string };

/** worker → 主进程（任务结果）：ok/err 按 id 配对（open 的成功值 = 方法名风格） */
export type WorkerReply =
  | { t: 'ok'; id: number; value?: unknown }
  | { t: 'err'; id: number; failure: WorkerFailure };

/** Worker 边界仅传输可序列化的错误身份，不把错误压扁成自由文本。 */
export type WorkerFailure =
  | { kind: 'source-problem'; code: SourceProblemCode; message: string; detail?: { sourceKey?: string; operation?: string } }
  | { kind: 'unsupported-source'; message: string; reason: string }
  | { kind: 'sandbox-missing'; message: string }
  | { kind: 'error'; message: string };

/** 主进程 → worker 的宿主回执（异步 http） */
export type HostReply = { t: 'httpRes'; id: number; res: HttpResponse } | { t: 'httpErr'; id: number; message: string };

/** 同步通道（SAB）的载荷格式 */
export interface SabPayload<T> {
  ok: boolean;
  value?: T;
  error?: string;
  code?: 'timeout' | 'oversized' | 'serialization' | 'protocol' | 'http-error';
}

/**
 * 以单次 CAS 抢占 SAB 回执。只有获胜者可以写数据区；先写字节与长度，再发布 READY，
 * 依赖 Atomics 的顺序保证消费者不会读到半帧。超限以状态码表示，避免截断 JSON。
 */
export function publishSabReply(sab: SharedArrayBuffer, payload: unknown): boolean {
  const control = new Int32Array(sab, 0, 2);
  if (Atomics.compareExchange(control, 0, SAB_PENDING, SAB_WRITING) !== SAB_PENDING) return false;
  const capacity = sab.byteLength - SAB_HEADER;
  try {
    const serialized = JSON.stringify(payload);
    if (typeof serialized !== 'string') throw new Error('结果无法序列化');
    const bytes = new TextEncoder().encode(serialized);
    if (bytes.byteLength > capacity) {
      Atomics.store(control, 1, 0);
      Atomics.store(control, 0, SAB_OVERSIZED);
      Atomics.notify(control, 0);
      return true;
    }
    new Uint8Array(sab, SAB_HEADER, bytes.byteLength).set(bytes);
    Atomics.store(control, 1, bytes.byteLength);
    Atomics.store(control, 0, SAB_READY);
    Atomics.notify(control, 0);
    return true;
  } catch {
    Atomics.store(control, 1, 0);
    Atomics.store(control, 0, SAB_SERIALIZATION_ERROR);
    Atomics.notify(control, 0);
    return true;
  }
}

/** 等待完成回执；超时线程也参与 CAS，因此迟到 HTTP 结果不能覆盖超时帧。 */
export function waitForSabReply<T>(sab: SharedArrayBuffer, timeoutMs: number, timeoutMessage: string): SabPayload<T> {
  const control = new Int32Array(sab, 0, 2);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let state = Atomics.load(control, 0);
  while (state === SAB_PENDING) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      publishSabReply(sab, { ok: false, code: 'timeout', error: timeoutMessage });
      state = Atomics.load(control, 0);
      break;
    }
    Atomics.wait(control, 0, SAB_PENDING, remaining);
    state = Atomics.load(control, 0);
  }
  // A publisher holds WRITING only while synchronously serializing/copying one bounded frame.
  // Wait for its READY/OVERSIZED state rather than reading data before publication.
  while (state === SAB_WRITING) {
    Atomics.wait(control, 0, SAB_WRITING);
    state = Atomics.load(control, 0);
  }
  if (state === SAB_OVERSIZED) return { ok: false, code: 'oversized', error: `同步通道响应超过 ${SAB_MAX_BYTES} 字节上限` };
  if (state === SAB_SERIALIZATION_ERROR) return { ok: false, code: 'serialization', error: '同步通道结果无法序列化' };
  if (state !== SAB_READY) return { ok: false, code: 'protocol', error: '同步通道未发布有效回执' };

  const length = Atomics.load(control, 1);
  const capacity = sab.byteLength - SAB_HEADER;
  if (length <= 0 || length > capacity) return { ok: false, code: 'protocol', error: '同步通道回执长度无效' };
  try {
    const value = JSON.parse(new TextDecoder().decode(new Uint8Array(sab, SAB_HEADER, length))) as SabPayload<T>;
    if (!value || typeof value !== 'object' || typeof value.ok !== 'boolean') {
      return { ok: false, code: 'protocol', error: '同步通道回执格式无效' };
    }
    return value;
  } catch (error) {
    return { ok: false, code: 'protocol', error: `同步通道解析失败: ${(error as Error).message}` };
  }
}
