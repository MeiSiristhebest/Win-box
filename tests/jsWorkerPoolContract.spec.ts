import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { EngineHost } from '../src/engine/ports';
import { JsWorkerPool } from '../src/engine/js/worker/JsWorkerPool';

const api = 'https://worker-contract.test/spider.js';
const retryApi = 'https://worker-contract.test/retry.js';
let tempRoot = '';
let workerFile = '';
let pool: JsWorkerPool | null = null;
let retryRequests = 0;

function makeHost(): EngineHost {
  return {
    http: {
      async request(request) {
        if (request.url === retryApi && ++retryRequests === 1) throw new Error('temporary worker network failure');
        if (request.url === retryApi) {
          return {
            status: 200,
            headers: { 'content-type': 'application/javascript' },
            content: "export default { homeContent() { return 'recovered'; } };",
            finalUrl: request.url,
          };
        }
        if (request.url !== api) throw new Error(`Unexpected worker test request: ${request.url}`);
        return {
          status: 200,
          headers: { 'content-type': 'application/javascript' },
          content: `
            export default {
              homeContent() { return undefined; },
              explode() { throw new Error('worker-script-error'); },
              delayed() { return new Promise(function (resolve) { setTimeout(function () { resolve('late'); }, 80); }); },
            };
          `,
          finalUrl: request.url,
        };
      },
    },
    kv: { get: () => '', set: () => undefined, delete: () => undefined },
    logger: { i: () => undefined, w: () => undefined, e: () => undefined },
  };
}

describe('JsWorkerPool — invocation failure contract', () => {
  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'winbox-js-worker-contract-'));
    workerFile = join(tempRoot, 'js-worker.cjs');
    buildSync({
      entryPoints: [resolve('src/engine/js/worker/entry.ts')],
      outfile: workerFile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      target: 'node26',
    });
    pool = new JsWorkerPool(makeHost(), workerFile);
  });

  afterAll(async () => {
    pool?.dispose();
    pool = null;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    const root = resolve(tmpdir());
    const target = resolve(tempRoot);
    const rel = relative(root, target);
    if (tempRoot && isAbsolute(target) && rel && rel !== '..' && !rel.startsWith(`..${sep}`)) {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('跨真实 worker 保留能力缺失、执行错误、超时及合法空值', async () => {
    if (!pool) throw new Error('Worker pool was not initialized');
    const sandbox = pool.createSandbox({ siteKey: 'worker-source', api, ext: '' });
    await sandbox.ensureLoaded();

    // Worker structured clone 将 undefined 规范化为 null；它仍然是成功回执。
    await expect(sandbox.callMethod(['homeContent'], [], 1000)).resolves.toBeNull();
    await expect(sandbox.callMethod(['missingOperation'], [], 1000)).rejects.toMatchObject({
      code: 'OPERATION_UNSUPPORTED',
      detail: { sourceKey: 'worker-source', operation: 'missingOperation' },
    });
    await expect(sandbox.callMethod(['explode'], [], 1000)).rejects.toMatchObject({
      code: 'SPIDER_ERROR',
      message: expect.stringContaining('worker-script-error'),
      detail: { sourceKey: 'worker-source', operation: 'explode' },
    });
    await expect(sandbox.callMethod(['delayed'], [], 5)).rejects.toMatchObject({
      code: 'SPIDER_TIMEOUT',
      detail: { sourceKey: 'worker-source', operation: 'delayed' },
    });
    await expect(sandbox.callMethod(['homeContent'], [], 1000)).resolves.toBeNull();
  });

  it('真实 worker 加载失败后保留错误并允许同一沙箱重试', async () => {
    if (!pool) throw new Error('Worker pool was not initialized');
    const sandbox = pool.createSandbox({ siteKey: 'retry-source', api: retryApi, ext: '' });
    await expect(sandbox.ensureLoaded()).rejects.toThrow('temporary worker network failure');
    await expect(sandbox.ensureLoaded()).resolves.toBeUndefined();
    await expect(sandbox.callMethod(['homeContent'], [], 1000)).resolves.toBe('recovered');
  });

  it('取消排队中的搜索调用，不终止同 worker 上正在执行的来源任务', async () => {
    if (!pool) throw new Error('Worker pool was not initialized');
    const sandbox = pool.createSandbox({ siteKey: 'cancel-source', api, ext: '' });
    await sandbox.ensureLoaded();

    const active = sandbox.callMethod(['delayed'], [], 1000);
    const controller = new AbortController();
    const queued = sandbox.callMethod(['homeContent'], [], 1000, controller.signal);
    controller.abort(new Error('search superseded'));

    await expect(queued).rejects.toThrow('search superseded');
    await expect(active).resolves.toBe('late');
    await expect(sandbox.callMethod(['homeContent'], [], 1000)).resolves.toBeNull();
  });

  it('取消打开等待后仍记录迟到的 worker 回执，下一次调用不重复加载', async () => {
    const host = makeHost();
    const requestStarted = Promise.withResolvers<void>();
    const releaseRequest = Promise.withResolvers<void>();
    const request = host.http.request.bind(host.http);
    let scriptRequests = 0;
    host.http.request = async (input) => {
      if (input.url === api) {
        scriptRequests += 1;
        requestStarted.resolve();
        await releaseRequest.promise;
      }
      return request(input);
    };

    const cancellablePool = new JsWorkerPool(host, workerFile);
    const sourceKey = 'cancel-open-source';
    const sandbox = cancellablePool.createSandbox({ siteKey: sourceKey, api, ext: '' });
    const controller = new AbortController();
    try {
      const opening = sandbox.ensureLoaded(controller.signal);
      await requestStarted.promise;
      controller.abort(new Error('open waiter cancelled'));
      await expect(opening).rejects.toThrow('open waiter cancelled');
      releaseRequest.resolve();

      await new Promise<void>((resolveWait, rejectWait) => {
        const deadline = Date.now() + 2000;
        const check = (): void => {
          if (cancellablePool.isOpen(sourceKey)) resolveWait();
          else if (Date.now() >= deadline) rejectWait(new Error('worker open reply did not arrive'));
          else setTimeout(check, 10);
        };
        check();
      });
      expect(cancellablePool.getOpenStyle(sourceKey)).toBe('hiker');

      await expect(sandbox.ensureLoaded()).resolves.toBeUndefined();
      expect(scriptRequests).toBe(1);
      await expect(sandbox.callMethod(['homeContent'], [], 1000)).resolves.toBeNull();
    } finally {
      releaseRequest.resolve();
      cancellablePool.dispose();
    }
  });

  it('取消正在运行的调用会立即通知调用方，但保留 worker 序列槽直到迟到结果返回', async () => {
    if (!pool) throw new Error('Worker pool was not initialized');
    const sandbox = pool.createSandbox({ siteKey: 'cancel-active-source', api, ext: '' });
    await sandbox.ensureLoaded();

    const controller = new AbortController();
    const active = sandbox.callMethod(['delayed'], [], 1000, controller.signal);
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
    const queued = sandbox.callMethod(['homeContent'], [], 1000);
    controller.abort(new Error('active search superseded'));

    await expect(active).rejects.toThrow('active search superseded');
    const queueState = await Promise.race([
      queued.then(() => 'settled'),
      new Promise<'pending'>(resolveWait => setTimeout(() => resolveWait('pending'), 15)),
    ]);
    expect(queueState).toBe('pending');
    await expect(queued).resolves.toBeNull();
    await expect(sandbox.callMethod(['homeContent'], [], 1000)).resolves.toBeNull();
  });

  it('worker 丢失后重开并重试时，若重试结果到达前调用方取消，仍报告取消', async () => {
    const recoveryPool = new JsWorkerPool(makeHost(), workerFile);
    const sourceKey = 'cancel-recovered-call';
    const sandbox = recoveryPool.createSandbox({ siteKey: sourceKey, api, ext: '' });
    const internals = recoveryPool as unknown as {
      route: Map<string, { w: { terminate(): Promise<number> } }>;
      onDown(worker: { w: { terminate(): Promise<number> } }, reason: string): void;
    };
    const mutablePool = recoveryPool as unknown as {
      call: (key: string, names: string[], args: unknown[], timeoutMs: number, signal?: AbortSignal) => Promise<unknown>;
    };
    const call = recoveryPool.call.bind(recoveryPool);
    const controller = new AbortController();
    let calls = 0;

    try {
      await sandbox.ensureLoaded();
      mutablePool.call = (key, names, args, timeoutMs, signal) => {
        calls += 1;
        if (calls === 1) {
          const worker = internals.route.get(key);
          if (!worker) throw new Error('expected a routed worker');
          void worker.w.terminate();
          internals.onDown(worker, 'contract test worker loss');
        }
        const result = call(key, names, args, timeoutMs, signal);
        return calls === 2
          ? result.then((value) => {
            controller.abort(new Error('search superseded after recovered result'));
            return value;
          })
          : result;
      };

      await expect(sandbox.callMethod(['homeContent'], [], 1000, controller.signal))
        .rejects.toThrow('search superseded after recovered result');
      expect(calls).toBe(2);
    } finally {
      recoveryPool.dispose();
    }
  });
});
