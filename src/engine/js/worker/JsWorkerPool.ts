// src/engine/js/worker/JsWorkerPool.ts
// ★★ 2026-09-30：JS 蜘蛛的执行侧（父进程视角）。
//   池内每个 worker 跑一个 node:vm 沙箱；宿主能力由父进程代劳：
//     · http      —— 消息往返（父进程的 HttpClient）
//     · httpSync  —— 父进程异步取数 → 写 SharedArrayBuffer → Atomics.notify（worker 侧阻塞等待）
//     · kv        —— 同 SAB 通道（内存表，微秒级）
//   关键收益：**同步 req 不再冻结主进程**；沙箱里的死循环/大计算只卡该 worker，
//   超时即 `terminate()` 杀掉重建（旧实现只能干等到 V8 返回）。
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import type { KVStore, Logger } from '../../../shared/types';
import type { JsSandboxHostPort, JsSpiderRuntimePort, SpiderStyle } from '../JsSandboxPort';
import { publishSabReply, type HostCall, type WorkerReply, type WorkerTask } from './protocol';
import { SourceProblemError } from '../../spider/errors';
import { UnsupportedSourceError } from '../../util/errors';
import { abortError, throwIfAborted } from '../../util/abort';

interface QueuedWorkerTask {
  start(): void;
  cancel(): void;
  fail(error: Error): void;
}

export type PooledSandboxFactory = ((init: { siteKey: string; api: string; ext: string }) => JsSpiderRuntimePort) & {
  dispose(): void;
};

/**
 * 池容量：★ 2026-10-17（B2）由 4 下调到 3（用户报「后台跑着五六个子进程、太臃肿」）。
 * 每个 worker 一份独立 V8 堆（带 js-lib 时更贵）；3 台已够常见并发，第 4 源起改为排队而非再开一台。
 */
const POOL_SIZE = 3;
/** 打开/切换类任务超时 */
const OPEN_TIMEOUT = 25_000;
/** ★ 2026-10-17（B2）：空闲回收 —— 某 worker 无任务超过这么久就 terminate（下次 pick 自动重建） */
const IDLE_RECLAIM_MS = 5 * 60_000;
const RECLAIM_INTERVAL_MS = 60_000;

interface PoolWorker {
  w: Worker;
  /** 该 worker 承载的源 key（粘性：同一源固定落同一 worker，保住沙箱内状态） */
  keys: Set<string>;
  queue: QueuedWorkerTask[];
  running: boolean;
  /** ★ 2026-10-17（B2）：最近一次承接任务的时刻（空闲回收据此判断，见 reclaimIdle） */
  lastUsed: number;
  /** 在途任务（open/call；超时/崩溃清账用）—— id → 回执 */
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  nextId: number;
  /** 已摘除标记：exit/error/terminate 可能先后触发，保证 onDown 只生效一次 */
  down: boolean;
}

class WorkerSandboxMissingError extends Error {}

function workerFailureError(failure: Extract<WorkerReply, { t: 'err' }>['failure']): Error {
  switch (failure.kind) {
    case 'source-problem':
      return new SourceProblemError(failure.code, failure.message, failure.detail);
    case 'unsupported-source':
      return new UnsupportedSourceError(failure.message, failure.reason);
    case 'sandbox-missing': return new WorkerSandboxMissingError(failure.message);
    case 'error':
      return new Error(failure.message);
  }
}

/** 与 JsSandbox 同形（JsSpider 只依赖这个面）—— 见 JsSandbox.ts 的 JsSandboxLike */

class PooledSandbox implements JsSpiderRuntimePort {
  readonly siteKey: string;
  spiderStyle: SpiderStyle = 'unknown';
  private ext: string;
  /** 已成功 open 过（风格可能仍是 unknown，但**不再重复 open**——避免每次调用都重建沙箱） */
  private opened = false;
  constructor(private readonly pool: JsWorkerPool, key: string, private readonly api: string, ext: string) {
    this.siteKey = key;
    this.ext = ext ?? '';
  }

  setExt(ext: string): void {
    this.ext = ext ?? '';
    this.pool.fire(this.siteKey, { t: 'setExt', key: this.siteKey, ext: this.ext });
  }

  async ensureLoaded(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    // ★ worker 被终止（打开/调用超时、崩溃）会连同其上的沙箱一起消失 —— 此时必须**重开**，
    //   否则后续调用永远报「沙箱未打开（key）」（实测：单源搜索 Cat_97 直接失败）。
    if (this.opened && this.pool.isOpen(this.siteKey)) return;
    const alreadyOpenStyle = this.pool.getOpenStyle(this.siteKey);
    if (alreadyOpenStyle !== undefined) {
      this.spiderStyle = alreadyOpenStyle;
      this.opened = true;
      return;
    }
    this.spiderStyle = (await this.pool.open(this.siteKey, this.api, this.ext, signal)) as SpiderStyle;
    throwIfAborted(signal);
    this.opened = true;
  }

  async callMethod(names: string[], args: unknown[], timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    await this.ensureLoaded(signal);
    try {
      const value = await this.pool.call(this.siteKey, names, args, timeoutMs, signal);
      throwIfAborted(signal);
      return value;
    } catch (e) {
      throwIfAborted(signal);
      // 宿主 worker 在 open 与 call 之间被摘除（竞态）→ 重开一次再试；其余错误如实抛出
      if (!(e instanceof WorkerSandboxMissingError)) throw e;
      this.opened = false;
      await this.ensureLoaded(signal);
      const value = await this.pool.call(this.siteKey, names, args, timeoutMs, signal);
      throwIfAborted(signal);
      return value;
    }
  }

  destroy(): void {
    this.pool.fire(this.siteKey, { t: 'destroy', key: this.siteKey });
    this.pool.forget(this.siteKey);
  }
}

export class JsWorkerPool {
  private workers: PoolWorker[] = [];
  private code = '';
  private disposed = false;
  /** key → worker（粘性路由；★ 存**引用**而不是数组下标 —— 摘除 worker 会让下标错位，把源路由到别的 worker） */
  private route = new Map<string, PoolWorker>();
  /** key → 已成功 open 的 worker（沙箱生命周期与 worker 绑定；worker 摘除时同步失效） */
  private openedOn = new Map<string, PoolWorker>();
  /** key → 已打开脚本的风格；底层 open 回执可能晚于已取消的调用方到达。 */
  private openedStyle = new Map<string, SpiderStyle>();

  /** ★ 2026-10-17（B2）：空闲回收定时器（`unref`，不阻进程退出） */
  private reclaimTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly host: JsSandboxHostPort,
    private readonly workerFile: string,
  ) {
    this.reclaimTimer = setInterval(() => this.reclaimIdle(), RECLAIM_INTERVAL_MS);
    this.reclaimTimer.unref?.();
  }

  createSandbox(init: { siteKey: string; api: string; ext: string }): JsSpiderRuntimePort {
    return new PooledSandbox(this, init.siteKey, init.api, init.ext);
  }

  /** 懒读 worker 代码（打包态在 asar 内也能 readFileSync；用 eval 启动，避路径解析问题） */
  private workerCode(): string {
    if (!this.code) this.code = readFileSync(this.workerFile, 'utf-8');
    return this.code;
  }

  private spawn(): PoolWorker {
    const w = new Worker(this.workerCode(), {
      eval: true,
      workerData: {
        jsLibDir: this.host.jsLibDir ?? '',
        proxyBase: this.host.proxyBase ?? 'http://127.0.0.1:9978/proxy',
      },
      name: 'winbox-js-spider',
    });
    const pw: PoolWorker = { w, keys: new Set(), queue: [], running: false, lastUsed: Date.now(), pending: new Map(), nextId: 1, down: false };
    w.on('message', (msg: WorkerReply | HostCall) => this.onMessage(pw, msg));
    w.on('error', (error: unknown) => this.onDown(pw, error instanceof Error ? error.message : String(error)));
    w.on('exit', (code) => {
      if (!this.disposed) this.onDown(pw, `worker 退出（code=${code}）`);
    });
    this.host.logger.i(`js-worker 池：已启动 worker #${this.workers.length + 1}（源 ${this.host.jsLibDir ? '带 js-lib' : '无 js-lib'}）`);
    return pw;
  }

  /** worker → 父：宿主调用与任务结果 */
  private onMessage(pw: PoolWorker, msg: WorkerReply | HostCall): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'http':
        this.host.http
          .request(msg.req)
          .then((res) => pw.w.postMessage({ t: 'httpRes', id: msg.id, res }))
          .catch((e: Error) => pw.w.postMessage({ t: 'httpErr', id: msg.id, message: e.message }));
        return;
      case 'httpSync': {
        // 同步通道的超时与 HTTP 结果通过 SAB CAS 竞争；第一个回执获胜，迟到结果不会覆写。
        const budget = Math.min((msg.req.timeoutMs ?? 10000) + 1000, 60_000);
        const timer = setTimeout(() => this.writeSab(msg.sab, { ok: false, code: 'timeout', error: `上游超时（>${budget}ms）` }), budget);
        this.host.http
          .request(msg.req)
          .then((res) => { clearTimeout(timer); this.writeSab(msg.sab, { ok: true, value: res }); })
          .catch((e: Error) => { clearTimeout(timer); this.writeSab(msg.sab, { ok: false, code: 'http-error', error: e.message }); });
        return;
      }
      case 'kv':
        try {
          const kv: KVStore = this.host.kv;
          let out = '';
          if (msg.op === 'get') out = kv.get(msg.key);
          else if (msg.op === 'set') kv.set(msg.key, msg.val ?? '');
          else kv.delete(msg.key);
          this.writeSab(msg.sab, { ok: true, value: out });
        } catch (e) {
          this.writeSab(msg.sab, { ok: false, error: (e as Error).message });
        }
        return;
      case 'log': {
        const logger: Logger = this.host.logger;
        if (msg.level === 'e') logger.e(msg.msg);
        else if (msg.level === 'w') logger.w(msg.msg);
        else logger.i(msg.msg);
        return;
      }
      case 'ok':
      case 'err': {
        const task = pw.pending.get(msg.id);
        if (!task) return;
        pw.pending.delete(msg.id);
        clearTimeout(task.timer);
        if (msg.t === 'ok') task.resolve(msg.value);
        else task.reject(workerFailureError(msg.failure));
      }
    }
  }

  /** SAB 写回（布局见 protocol.ts）：[0]=状态 [1]=长度 [8..]=UTF-8 JSON */
  private writeSab(sab: SharedArrayBuffer, payload: unknown): void {
    publishSabReply(sab, payload);
  }

  /** worker 崩溃/被终止：清账 + 摘除（下次任务自动重建）；重复触发只生效一次 */
  private onDown(pw: PoolWorker, reason: string): void {
    if (pw.down) return;
    pw.down = true;
    const failure = new Error(`JS 沙箱进程不可用：${reason}`);
    for (const [, t] of pw.pending) {
      clearTimeout(t.timer);
      t.reject(failure);
    }
    pw.pending.clear();
    for (const task of pw.queue.splice(0)) task.fail(failure);
    const i = this.workers.indexOf(pw);
    if (i >= 0) this.workers.splice(i, 1);
    for (const [k, w] of this.route.entries()) if (w === pw) this.route.delete(k);
    for (const [k, w] of this.openedOn.entries()) {
      if (w === pw) {
        this.openedOn.delete(k);
        this.openedStyle.delete(k);
      }
    }
    pw.keys.clear();
    this.host.logger.w(`js-worker 已摘除（${reason}），下次调用自动重建`);
  }

  private pick(key: string): PoolWorker {
    if (this.disposed) throw new Error('JS worker 池已销毁');
    const routed = this.route.get(key);
    if (routed && !routed.down && this.workers.includes(routed)) return routed;
    while (this.workers.length < POOL_SIZE) this.workers.push(this.spawn());
    let best = this.workers[0];
    for (const w of this.workers) if (w.keys.size < best.keys.size) best = w;
    best.keys.add(key);
    this.route.set(key, best);
    return best;
  }

  /** 同一 worker 内 FIFO（跨源互不干扰；沙箱内状态安全） */
  private run<T>(pw: PoolWorker, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let started = false;
      let callerSettled = false;
      let entry: QueuedWorkerTask;
      const removeAbortListener = (): void => signal?.removeEventListener('abort', cancel);
      const cancel = (): void => {
        if (callerSettled) return;
        callerSettled = true;
        if (!started) {
          const index = pw.queue.indexOf(entry);
          if (index >= 0) pw.queue.splice(index, 1);
        }
        removeAbortListener();
        reject(signal ? abortError(signal) : new Error('操作已取消'));
      };
      const fail = (error: Error): void => {
        if (callerSettled) return;
        callerSettled = true;
        if (!started) {
          const index = pw.queue.indexOf(entry);
          if (index >= 0) pw.queue.splice(index, 1);
        }
        removeAbortListener();
        reject(error);
      };
      const start = (): void => {
        if (started || callerSettled) return;
        if (signal?.aborted) {
          cancel();
          return;
        }
        started = true;
        if (pw.down) {
          callerSettled = true;
          removeAbortListener();
          reject(new Error('JS worker 已退出'));
          return;
        }
        pw.running = true;
        pw.lastUsed = Date.now(); // ★ 2026-10-17（B2）：刷新活跃时刻（空闲回收据此判断）
        Promise.resolve()
          .then(() => callerSettled ? undefined as T : fn())
          .then(
            (value) => {
              if (callerSettled) return;
              callerSettled = true;
              removeAbortListener();
              resolve(value);
            },
            (error: unknown) => {
              if (callerSettled) return;
              callerSettled = true;
              removeAbortListener();
              reject(error);
            },
          )
          .finally(() => {
            // An active worker call cannot be interrupted without killing sibling sandboxes.
            // Keep the serialized slot until its real reply/timeout, even if the caller left.
            removeAbortListener();
            pw.running = false;
            pw.queue.shift()?.start();
          });
      };
      entry = { start, cancel, fail };
      if (signal?.aborted) {
        cancel();
        return;
      }
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }
      if (pw.running) {
        pw.queue.push(entry);
      } else start();
    });
  }

  /** 无回执任务（setExt / destroy） */
  fire(key: string, msg: WorkerTask): void {
    // Best-effort updates/destruction must never allocate a pool just to send a
    // message. Opening a sandbox is the only operation that creates a worker.
    const pw = this.route.get(key);
    if (!pw || pw.down || this.disposed) return;
    this.run(pw, async () => {
      try {
        pw.w.postMessage(msg);
      } catch {
        /* worker 已死：忽略 */
      }
    }).catch(() => undefined);
  }

  /** 投递一个**带回执**的任务（open/call 共用）：超时 → terminate + 摘除 + reject */
  private invoke<T>(pw: PoolWorker, budget: number, downReason: string, timeoutError: Error, task: (id: number) => WorkerTask): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = pw.nextId++;
      const timer = setTimeout(() => {
        pw.pending.delete(id);
        void pw.w.terminate();
        this.onDown(pw, downReason);
        reject(timeoutError);
      }, budget);
      pw.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        pw.w.postMessage(task(id));
      } catch (e) {
        clearTimeout(timer);
        pw.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  /** 调用蜘蛛方法（带超时；超时 → 杀掉该 worker） */
  call(key: string, names: string[], args: unknown[], timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    throwIfAborted(signal);
    const pw = this.pick(key);
    const budget = Math.max(3000, timeoutMs + 1000);
    return this.run(pw, () =>
      this.invoke(
        pw,
        budget,
        `调用超时（>${Math.round(budget / 1000)}s），沙箱已终止`,
        new SourceProblemError(
          'SPIDER_TIMEOUT',
          `JS 蜘蛛调用超时（>${Math.round(timeoutMs / 1000)}s），已终止其沙箱`,
          { sourceKey: key, operation: names[0] || 'unknown' },
        ),
        (id) => ({ t: 'call', id, key, names, args, timeoutMs }),
      ),
      signal,
    );
  }

  /**
   * 打开沙箱（加载脚本 + init 转发）→ 返回方法名风格。
   * ★ 失败**必须 reject**（脚本 404/语法错/字节码…）：调用方（JsSpider.getSandbox）据此给该源
   *   一次性降级；此前失败回执落空 → 只能等 OPEN_TIMEOUT 杀 worker，表现为「JS 源连环打开超时」。
   */
  open(key: string, api: string, ext: string, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const pw = this.pick(key);
    return this.run(pw, () =>
      this.invoke<string>(
        pw,
        OPEN_TIMEOUT,
        '打开超时（脚本加载/init 无响应）',
        new SourceProblemError(
          'SPIDER_TIMEOUT',
          `JS 蜘蛛脚本打开超时（>${Math.round(OPEN_TIMEOUT / 1000)}s），已终止其沙箱`,
          { sourceKey: key },
        ),
        (id) => ({ t: 'open', id, key, api, ext }),
      ).then((v) => {
        const style = String(v ?? 'unknown') as SpiderStyle;
        // 记录底层 worker 回执，而不是 run() 的调用方结果：调用方可先取消等待，
        // 但已经开始的 open 仍会运行并占用该源的 worker 状态。
        this.openedOn.set(key, pw);
        this.openedStyle.set(key, style);
        return style;
      }),
      signal,
    );
  }

  /** 该 key 的沙箱当前是否活在某个 worker 上（PooledSandbox 据此决定是否重开） */
  isOpen(key: string): boolean {
    const w = this.openedOn.get(key);
    return !!w && !w.down && this.workers.includes(w);
  }

  getOpenStyle(key: string): SpiderStyle | undefined {
    return this.isOpen(key) ? this.openedStyle.get(key) : undefined;
  }

  forget(key: string): void {
    const w = this.route.get(key);
    if (w) {
      w.keys.delete(key);
      this.route.delete(key);
    }
    this.openedOn.delete(key);
    this.openedStyle.delete(key);
  }

  /**
   * ★ 2026-10-17（B2）：空闲回收 —— 无 pending / 无排队且闲置超过 IDLE_RECLAIM_MS 的 worker 直接 terminate
   *   （走 onDown 摘除：路由与沙箱标记同步失效，下次 `pick` 自动重建，语义与「超时被杀」完全一致）。
   *   至少保留 1 台，避免下次调用还要付「起 worker + 加载脚本」。
   */
  private reclaimIdle(): void {
    if (this.disposed) return;
    const now = Date.now();
    // onDown removes entries from the live array; retain a snapshot for this pass.
    const candidates = this.workers.slice();
    for (const w of candidates) {
      if (this.workers.filter((x) => !x.down).length <= 1) break; // 至少留 1 台热 worker
      if (w.down || w.pending.size > 0 || w.queue.length > 0 || now - w.lastUsed <= IDLE_RECLAIM_MS) continue;
      this.host.logger.i(`js-worker 池：空闲回收 worker（>${Math.round(IDLE_RECLAIM_MS / 60_000)} 分钟无任务），下次调用自动重建`);
      void w.w.terminate();
      this.onDown(w, '空闲回收');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.reclaimTimer) {
      clearInterval(this.reclaimTimer);
      this.reclaimTimer = null;
    }
    const workers = this.workers.slice();
    for (const w of workers) {
      this.onDown(w, 'worker pool disposed');
      void w.w.terminate();
    }
    this.workers = [];
    this.route.clear();
    this.openedOn.clear();
    this.openedStyle.clear();
  }
}

/** 「池化沙箱」工厂：注入到 EngineHost.jsSandboxFactory（测试/降级不注入 → 进程内 node:vm） */
export function createPooledSandboxFactory(
  host: JsSandboxHostPort,
  workerFile: string,
): PooledSandboxFactory {
  const pool = new JsWorkerPool(host, workerFile);
  const factory = ((init) => pool.createSandbox(init)) as PooledSandboxFactory;
  factory.dispose = () => pool.dispose();
  return factory;
}
