// src/main/plugin/sandbox/protocol.ts
// L4 沙箱的消息协议（worker ↔ 主进程）。
//
// ★ 取向（R10 拍板）：**全异步消息往返，不用 SharedArrayBuffer/Atomics**。
//   引擎侧 `JsWorkerPool` 需要 SAB 是因为 drpy/hiker 蜘蛛有**同步 `req()`**；
//   而 L4 的作者 API 形如 `winbox.http(url).text()`（fetch 风格，天然异步）——
//   没有同步语义需求，纯 `postMessage` 往返即可，少一条共享内存路径 = 少一类竞态。
//
// ★ 权限门禁**不在本文件**：它由 worker 侧 `buildWinbox(permissions, call)` 构造 globals 实现
//   （未授权的组**根本不挂** → 调用即 TypeError）。本文件只是能力**调用**的线格式。
//
// 事实源：docs/design/插件制作规范.md §6.1；docs/spec/R10-l4-sandbox-api/spec.md §3。

import type { PermissionId } from '../../../shared/plugin';
import type { SpiderRuntimeContribute, SpiderRuntimeOperation } from '../../../shared/plugin';

/** `winbox.http(url, opts)` 的 opts（受限：仅 get/post + 头 + 体） */
export interface PluginHttpOpts {
  method?: 'get' | 'post';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * `winbox.player.*` 的动作词表（宿主转发给播放器窗口执行，插件不碰内核）。
 * ★ 与规范 §6.1「play / pause / seek / next / 音轨 / 字幕 / 音量」对齐（`prev` 为自然补全）。
 * ★ 刻意**不含** `toggle` / `stop` —— 渲染层无对应的受控实现，不提供假能力。
 */
export type PlayerOp =
  | 'play' | 'pause' | 'seek' | 'volume' | 'next' | 'prev'
  | 'audioTrack' | 'subtitle';

/** fs.plugin 的算子 */
export type FsOp = 'read' | 'write' | 'list' | 'exists' | 'delete' | 'mkdir';

/** worker → 主进程：能力调用 + 生命周期回执 */
export type HostCall =
  | { t: 'http'; id: number; url: string; opts?: PluginHttpOpts }
  | { t: 'download'; id: number; url: string; name: string }
  | { t: 'kv'; id: number; op: 'get' | 'set' | 'delete'; key: string; val?: string }
  | { t: 'settings'; id: number; op: 'get' | 'set'; key: string; val?: unknown }
  | { t: 'fs'; id: number; op: FsOp; rel: string; data?: string }
  | { t: 'log'; level: 'i' | 'w' | 'e'; msg: string }
  | { t: 'notify'; id: number; title: string; body: string }
  | { t: 'clipboard'; id: number; op: 'read' | 'write'; text?: string }
  | { t: 'dialog'; id: number; op: 'alert' | 'confirm'; message: string; title?: string }
  | { t: 'player'; id: number; op: PlayerOp; value?: unknown }
  | { t: 'openExternal'; id: number; url: string }
  /** 沙箱入口（`main`）已加载完成 */
  | { t: 'ready' }
  /** 沙箱入口加载失败（脚本缺失 / 语法错 / 抛错） */
  | { t: 'failed'; message: string };

/** 主进程 → worker：调用回执 + 下载进度 */
export type HostReply =
  | { t: 'reply'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'progress'; id: number; loaded: number; total: number };

/** Host-initiated Spider calls; plugin code is only run after the manifest permission is confirmed. */
export type SpiderRuntimeHostRequest =
  | { t: 'spider.invoke'; id: number; providerId: string; operation: SpiderRuntimeOperation; input: unknown }
  | { t: 'spider.cancel'; id: number };

/** Worker-to-host result for a host-initiated Spider call. */
export interface SpiderRuntimeWorkerResult {
  t: 'spider.result';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type PluginWorkerMessage = HostCall | SpiderRuntimeWorkerResult;

/** worker 启动参数（`workerData`） */
export interface PluginWorkerData {
  pluginId: string;
  /** 插件根目录（`<pluginsDir>/<id>.winbox`）—— `fs.plugin` 的根 */
  pluginDir: string;
  /** 沙箱入口相对名（`manifest.main`，如 `main.js`） */
  mainFile: string;
  /** 已授权权限（★ 决定 globals 里挂哪些 `winbox.*`） */
  permissions: PermissionId[];
  /** Manifest-validated protocols, sent only with the explicit spider.runtime permission. */
  spiderRuntimes: SpiderRuntimeContribute[];
}

/** 单次宿主调用（worker 侧注入 `buildWinbox`；返回 Promise） */
export type SandboxCall = (call: HostCall) => Promise<unknown>;

/**
 * 宿主能力实现面（**主进程侧**；由 `main/index.ts` 组装 → 沙箱管理器 → worker 回调）。
 * ★ 这是「宿主唯一对外暴露的沙箱能力面」——`PluginSandbox` 只依赖它，便于单测注入假件。
 */
export interface PluginSandboxApi {
  /** 经宿主 HttpClient 的 HTTP（返回文本；`text()` 由 worker 侧包装） */
  http(pluginId: string, url: string, opts?: PluginHttpOpts): Promise<{ status: number; headers: Record<string, string | string[]>; content: string }>;
  /** 下载落**插件目录**（`onProgress` 见规范 §6.1：v1 非流式，仅开始/完成两帧） */
  download(pluginId: string, url: string, name: string, onProgress: (loaded: number, total: number) => void): Promise<{ bytes: number }>;
  /** 命名空间 KV（键前缀 `plugin:<id>:` 由宿主拼接） */
  kv(pluginId: string, op: 'get' | 'set' | 'delete', key: string, val?: string): string;
  /** 插件自身设置项（与 `settings.panel` 同一份存储） */
  settings(pluginId: string, op: 'get' | 'set', key: string, val?: unknown): unknown;
  /** 仅插件自身目录内的文件系统（越界即拒） */
  fs(pluginId: string, op: FsOp, rel: string, data?: string): unknown;
  log(pluginId: string, level: 'i' | 'w' | 'e', msg: string): void;
  notify(pluginId: string, title: string, body: string): Promise<void>;
  clipboard(pluginId: string, op: 'read' | 'write', text?: string): string | Promise<string>;
  dialog(pluginId: string, op: 'alert' | 'confirm', message: string, title?: string): Promise<boolean | void>;
  player(pluginId: string, op: PlayerOp, value?: unknown): Promise<{ ok: boolean; reason?: string }>;
  openExternal(pluginId: string, url: string): Promise<void>;
}
