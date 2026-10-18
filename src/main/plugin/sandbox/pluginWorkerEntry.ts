// src/main/plugin/sandbox/pluginWorkerEntry.ts
// L4 沙箱的 **worker 线程入口**：在**独立线程**里跑 `node:vm`，加载插件的 `main`。
//   由主进程用 `new Worker(代码, { eval: true, workerData })` 启动（见 PluginSandbox.ts）——
//   eval 方式不依赖模块路径解析，打包态 asar 内也能跑（同引擎侧 js-worker 口径）。
//
// ★ 安全边界：第三方代码**只在这里**跑；本线程除本协议暴露的能力外，**没有任何**宿主能力。
//   （`require`/`process`/`fs`/`child_process` 在 vm 上下文里**不存在** —— 见 buildWinbox.ts。）
//
// 事实源：docs/spec/R10-l4-sandbox-api/spec.md §6.1。

import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { buildWinbox, type WinboxGlobals } from './buildWinbox';
import type { HostCall, HostReply, PluginWorkerData, SandboxCall } from './protocol';

const cfg = (workerData ?? {}) as PluginWorkerData;
const port = parentPort;
if (!port) throw new Error('plugin-worker 必须由 worker_threads 启动');

/** main 加载完成前先建好进度派发口（progress 可能在 boot 之后才到） */
let wg: WinboxGlobals | null = null;
/** 在途能力调用：id → 回执 */
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** 宿主调用桥：无 `id` 的消息（`log` / 生命周期）fire-and-forget，其余按 id 等 reply */
const call: SandboxCall = (msg: HostCall) => {
  if (!('id' in msg)) {
    port.postMessage(msg);
    return Promise.resolve(undefined);
  }
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
    port.postMessage(msg);
  });
};

port.on('message', (msg: HostReply) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'progress') {
    wg?.deliverProgress(msg.id, msg.loaded, msg.total);
    return;
  }
  if (msg.t === 'reply') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(new Error(msg.error || '宿主调用失败'));
  }
});

/**
 * 读 `main` 并在 vm 上下文内执行。
 * ★ 包成 **async IIFE** 以支持顶层 `await`（作者可直接 `await winbox.http(...)`）。
 */
async function boot(): Promise<void> {
  wg = buildWinbox(Array.isArray(cfg.permissions) ? cfg.permissions : [], call);
  const ctx = vm.createContext(wg.globals);
  const file = join(cfg.pluginDir, cfg.mainFile);
  let src: string;
  try {
    src = readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
  } catch {
    throw new Error(`沙箱入口文件读取失败：${cfg.mainFile}`);
  }
  const wrapped = `(async () => {\n${src}\n})()`;
  const ret = vm.runInContext(wrapped, ctx, { filename: file, timeout: 10_000 });
  if (ret && typeof (ret as { then?: unknown }).then === 'function') await (ret as Promise<unknown>);
}

boot().then(
  () => port.postMessage({ t: 'ready' } satisfies HostCall),
  (e: unknown) => {
    const frame = e instanceof Error && e.stack ? (e.stack.split('\n')[1] ?? '').trim() : '';
    const message = `${e instanceof Error ? e.message : String(e)}${frame ? ` @ ${frame}` : ''}`;
    port.postMessage({ t: 'failed', message } satisfies HostCall);
  },
);
