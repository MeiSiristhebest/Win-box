// src/main/plugin/sandbox/buildWinbox.ts
// ★★ L4 沙箱的**权限门禁**（纯函数、无 electron / 无 node:vm 依赖，可单测）★★
//
// 铁律（R10，规范 §6.2）：沙箱内**未授权的 `winbox.*` 根本不存在**（`typeof === 'undefined'`，
//   调用即 `TypeError`），**不是**「存在但抛错」。→ 由本文件的**挂载表**保证：
//   只把已授权的组挂到 `winbox` 上，其余一律不挂。
//
// 另一条铁律：沙箱全局**没有** `require` / `process` / `module` / `exports` / `global` /
//   `Buffer` / `fs` / `child_process` —— 只给出最小集（console + 定时器 + 编码/URL 工具）。
//
// 事实源：docs/design/插件制作规范.md §6.1；docs/spec/R10-l4-sandbox-api/spec.md §4。

import type { PermissionId } from '../../../shared/plugin';
import type { PluginHttpOpts, PlayerOp, SandboxCall } from './protocol';

/** 构建结果：`winbox` 对象 + vm 上下文全局 + 下载进度派发口 */
export interface WinboxGlobals {
  /** 按已授权权限构造的 `winbox`（未授权组不挂） */
  winbox: Record<string, unknown>;
  /** vm.createContext 用的全局对象（含 winbox + 最小工具集） */
  globals: Record<string, unknown>;
  /** 宿主回 `progress` 消息时按 id 派发（`download` 的 onProgress） */
  deliverProgress(id: number, loaded: number, total: number): void;
}

/** 把任意值转成可读日志文本（console 用） */
function toText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

/** URL 是否 http(s)（`openExternal` 的本地前置校验） */
function isHttpUrl(u: unknown): boolean {
  return typeof u === 'string' && /^https?:\/\//i.test(u.trim()) && !/[\s\r\n]/.test(u.trim());
}

/**
 * 按**已授权权限**构造沙箱全局。
 *
 * @param permissions 已授权权限（来自 `manifest.permissions`，安装期已过白名单校验）
 * @param call        宿主调用桥（worker 侧注入；返回 Promise）
 */
export function buildWinbox(permissions: readonly PermissionId[], call: SandboxCall): WinboxGlobals {
  const has = (p: PermissionId): boolean => permissions.includes(p);
  /** 每次能力调用分配一个自增 id（与宿主回执/进度按 id 配对） */
  let seq = 1;
  const nextId = (): number => seq++;

  const progressCbs = new Map<number, (loaded: number, total: number) => void>();

  const winbox: Record<string, unknown> = {};

  // ---- net（HTTP，经宿主）----
  if (has('net')) {
    winbox.http = (url: unknown, opts?: unknown): Promise<unknown> =>
      call({ t: 'http', id: nextId(), url: String(url ?? ''), opts: (opts ?? undefined) as PluginHttpOpts | undefined })
        .then((res) => {
          const r = res as { status: number; headers: Record<string, string | string[]>; content: string };
          // ★ text() 在**沙箱内**包装（宿主回的是纯数据，函数不可跨 worker 传递）
          return { status: r.status, headers: r.headers, text: (): string => r.content };
        });
  }

  // ---- net.download（落插件目录；onProgress 由宿主 progress 消息驱动）----
  if (has('net.download')) {
    winbox.download = (url: unknown, name: unknown, onProgress?: unknown): Promise<unknown> => {
      const id = nextId();
      if (typeof onProgress === 'function') progressCbs.set(id, onProgress as (l: number, t: number) => void);
      return call({ t: 'download', id, url: String(url ?? ''), name: String(name ?? '') })
        .finally(() => progressCbs.delete(id));
    };
  }

  // ---- kv（键前缀 `plugin:<id>:` 由宿主拼接）----
  if (has('kv')) {
    winbox.kv = {
      get: (key: unknown): Promise<unknown> => call({ t: 'kv', id: nextId(), op: 'get', key: String(key ?? '') }),
      set: (key: unknown, val: unknown): Promise<unknown> =>
        call({ t: 'kv', id: nextId(), op: 'set', key: String(key ?? ''), val: val == null ? '' : String(val) }),
      delete: (key: unknown): Promise<unknown> => call({ t: 'kv', id: nextId(), op: 'delete', key: String(key ?? '') }),
    };
  }

  // ---- settings（读写插件自身设置项，与 settings.panel 同一份存储）----
  if (has('settings')) {
    winbox.settings = {
      get: (key: unknown): Promise<unknown> => call({ t: 'settings', id: nextId(), op: 'get', key: String(key ?? '') }),
      set: (key: unknown, val: unknown): Promise<unknown> =>
        call({ t: 'settings', id: nextId(), op: 'set', key: String(key ?? ''), val }),
    };
  }

  // ---- fs.plugin（相对插件根；越界由宿主拒绝）----
  if (has('fs.plugin')) {
    winbox.fs = {
      read: (rel: unknown): Promise<unknown> => call({ t: 'fs', id: nextId(), op: 'read', rel: String(rel ?? '') }),
      write: (rel: unknown, data: unknown): Promise<unknown> =>
        call({ t: 'fs', id: nextId(), op: 'write', rel: String(rel ?? ''), data: data == null ? '' : String(data) }),
      list: (rel?: unknown): Promise<unknown> => call({ t: 'fs', id: nextId(), op: 'list', rel: String(rel ?? '') }),
      exists: (rel: unknown): Promise<unknown> => call({ t: 'fs', id: nextId(), op: 'exists', rel: String(rel ?? '') }),
      delete: (rel: unknown): Promise<unknown> => call({ t: 'fs', id: nextId(), op: 'delete', rel: String(rel ?? '') }),
      mkdir: (rel: unknown): Promise<unknown> => call({ t: 'fs', id: nextId(), op: 'mkdir', rel: String(rel ?? '') }),
    };
  }

  // ---- log ----
  if (has('log')) {
    winbox.log = {
      i: (m: unknown): void => void call({ t: 'log', level: 'i', msg: toText(m) }),
      w: (m: unknown): void => void call({ t: 'log', level: 'w', msg: toText(m) }),
      e: (m: unknown): void => void call({ t: 'log', level: 'e', msg: toText(m) }),
    };
  }

  // ---- notify ----
  if (has('notify')) {
    winbox.notify = (title: unknown, body: unknown): Promise<unknown> =>
      call({ t: 'notify', id: nextId(), title: toText(title), body: toText(body) });
  }

  // ---- clipboard（read / write 可分别授权）----
  {
    const clip: Record<string, unknown> = {};
    if (has('clipboard.read')) clip.read = (): Promise<unknown> => call({ t: 'clipboard', id: nextId(), op: 'read' });
    if (has('clipboard.write')) {
      clip.write = (text: unknown): Promise<unknown> =>
        call({ t: 'clipboard', id: nextId(), op: 'write', text: text == null ? '' : String(text) });
    }
    if (Object.keys(clip).length) winbox.clipboard = clip;
  }

  // ---- dialog（仅展示）----
  if (has('dialog')) {
    winbox.dialog = {
      alert: (message: unknown, title?: unknown): Promise<unknown> =>
        call({ t: 'dialog', id: nextId(), op: 'alert', message: toText(message), title: title == null ? undefined : toText(title) }),
      confirm: (message: unknown, title?: unknown): Promise<unknown> =>
        call({ t: 'dialog', id: nextId(), op: 'confirm', message: toText(message), title: title == null ? undefined : toText(title) }),
    };
  }

  // ---- player.control（经宿主转发给播放器窗口，不碰内核）----
  if (has('player.control')) {
    const ops: Array<[string, PlayerOp, 'none' | 'value']> = [
      ['play', 'play', 'none'], ['pause', 'pause', 'none'],
      ['seek', 'seek', 'value'], ['volume', 'volume', 'value'],
      ['next', 'next', 'none'], ['prev', 'prev', 'none'],
      ['audioTrack', 'audioTrack', 'value'], ['subtitle', 'subtitle', 'value'],
    ];
    const player: Record<string, unknown> = {};
    for (const [name, op, kind] of ops) {
      player[name] = (value?: unknown): Promise<unknown> =>
        call({ t: 'player', id: nextId(), op, value: kind === 'value' ? value : undefined });
    }
    winbox.player = player;
  }

  // ---- openExternal（仅 http(s)；非法链接**本地即拒**）----
  if (has('openExternal')) {
    winbox.openExternal = (url: unknown): Promise<unknown> => {
      if (!isHttpUrl(url)) throw new Error(`openExternal 仅允许 http/https 链接：${String(url)}`);
      return call({ t: 'openExternal', id: nextId(), url: String(url) });
    };
  }

  // ---- 沙箱最小全局集（非 winbox.*；不含 require/process/fs/Buffer）----
  const silent = (): void => undefined;
  const logFn = (level: 'i' | 'w' | 'e') =>
    has('log') ? (...args: unknown[]): void => void call({ t: 'log', level, msg: args.map(toText).join(' ') }) : silent;
  const consoleShim = {
    log: logFn('i'), info: logFn('i'), debug: logFn('i'),
    warn: logFn('w'), error: logFn('e'),
    // 兼容少量常见方法（避免插件误用崩溃）
    trace: logFn('i'), dir: logFn('i'),
  };

  const g = globalThis as unknown as Record<string, unknown>;
  /** 取宿主全局函数并绑回 globalThis（安全兜底：缺失 → undefined） */
  const fn = (name: string): unknown => {
    const f = g[name];
    return typeof f === 'function' ? (f as (...a: unknown[]) => unknown).bind(globalThis) : undefined;
  };
  const globals: Record<string, unknown> = {
    winbox,
    console: consoleShim,
    setTimeout: fn('setTimeout'),
    clearTimeout: fn('clearTimeout'),
    setInterval: fn('setInterval'),
    clearInterval: fn('clearInterval'),
    TextEncoder: g.TextEncoder,
    TextDecoder: g.TextDecoder,
    URL: g.URL,
    URLSearchParams: g.URLSearchParams,
    atob: fn('atob'),
    btoa: fn('btoa'),
  };

  return {
    winbox,
    globals,
    deliverProgress: (id: number, loaded: number, total: number): void => {
      const cb = progressCbs.get(id);
      if (cb) {
        try {
          cb(loaded, total);
        } catch {
          /* 插件的进度回调抛错不应拖垮宿主 */
        }
      }
    },
  };
}
