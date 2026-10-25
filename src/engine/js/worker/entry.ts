// src/engine/js/worker/entry.ts —— worker 线程入口：在本线程里跑 JsSandbox（复用同一份实现）。
// 由主进程用 `new Worker(代码, { eval: true, workerData })` 启动（见 JsWorkerPool）。
import { parentPort, workerData } from 'node:worker_threads';
import { JsSandbox } from '../JsSandbox';
import { createRemoteHost } from './remoteHost';
import type { WorkerReply, WorkerTask } from './protocol';
import { SourceProblemError } from '../../spider/errors';
import { UnsupportedSourceError } from '../../util/errors';

interface WorkerData {
  jsLibDir: string;
  proxyBase: string;
}

const cfg = (workerData ?? { jsLibDir: '', proxyBase: 'http://127.0.0.1:9978/proxy' }) as WorkerData;
const port = parentPort;
if (!port) throw new Error('js-worker 必须由 worker_threads 启动');

const host = createRemoteHost(port, { jsLibDir: cfg.jsLibDir, proxyBase: cfg.proxyBase });
const sandboxes = new Map<string, JsSandbox>();

/** 结果值经 structured clone 回传；不可克隆（含函数/循环引用）时退回 JSON 文本 */
function safeClone(v: unknown): unknown {
  if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v ?? null;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

function serializeFailure(error: unknown): Extract<WorkerReply, { t: 'err' }>['failure'] {
  if (error instanceof SourceProblemError) {
    const detail = error.detail && typeof error.detail === 'object' ? error.detail as Record<string, unknown> : null;
    return {
      kind: 'source-problem',
      code: error.code,
      message: error.message,
      ...(detail ? {
        detail: {
          ...(typeof detail.sourceKey === 'string' ? { sourceKey: detail.sourceKey } : {}),
          ...(typeof detail.operation === 'string' ? { operation: detail.operation } : {}),
        },
      } : {}),
    };
  }
  if (error instanceof UnsupportedSourceError) {
    return { kind: 'unsupported-source', message: error.message, reason: error.reason };
  }
  return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
}

port.on('message', (msg: WorkerTask) => {
  void (async () => {
    try {
      if (msg.t === 'open') {
        let sb = sandboxes.get(msg.key);
        if (!sb) {
          sb = new JsSandbox({ siteKey: msg.key, api: msg.api, ext: msg.ext, host, jsLibDir: cfg.jsLibDir });
          sandboxes.set(msg.key, sb);
        } else {
          sb.setExt(msg.ext);
        }
        await sb.ensureLoaded();
        port.postMessage({ t: 'ok', id: msg.id, value: sb.spiderStyle } satisfies WorkerReply);
        return;
      }
      if (msg.t === 'setExt') {
        sandboxes.get(msg.key)?.setExt(msg.ext);
        port.postMessage({ t: 'ok', id: -1 } satisfies WorkerReply);
        return;
      }
      if (msg.t === 'destroy') {
        const sb = sandboxes.get(msg.key);
        sb?.destroy();
        sandboxes.delete(msg.key);
        port.postMessage({ t: 'ok', id: -1 } satisfies WorkerReply);
        return;
      }
      if (msg.t === 'call') {
        const sb = sandboxes.get(msg.key);
        if (!sb) {
          port.postMessage({
            t: 'err', id: msg.id,
            failure: { kind: 'sandbox-missing', message: `沙箱未打开（${msg.key}）` },
          } satisfies WorkerReply);
          return;
        }
        const value = await sb.callMethod(msg.names, msg.args, msg.timeoutMs);
        port.postMessage({ t: 'ok', id: msg.id, value: safeClone(value) } satisfies WorkerReply);
        return;
      }
    } catch (e) {
      const id = msg.t === 'call' || msg.t === 'open' ? msg.id : -1;
      port.postMessage({ t: 'err', id, failure: serializeFailure(e) } satisfies WorkerReply);
    }
  })();
});
