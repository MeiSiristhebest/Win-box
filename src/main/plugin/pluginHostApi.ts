// src/main/plugin/pluginHostApi.ts
// L4 沙箱的**宿主能力实现面**（规范 §6.1 全 11 组的宿主侧）。
//
// ★ 本文件**不 import electron**（系统件由 deps 注入）—— 这样单测可直接跑 `createPluginSandboxApi`
//   验「fs 越界拒绝 / settings 校验 / kv 前缀」等纯逻辑，不必起 electron。
//
// 事实源：docs/design/插件制作规范.md §6.1；docs/spec/R10-l4-sandbox-api/spec.md §5。

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { HttpClient, Logger } from '../../shared/types';
import { isSafeRelPath } from '../../shared/plugin';
import type { FsOp, PlayerOp, PluginHttpOpts, PluginSandboxApi } from './sandbox/protocol';
import type { PluginKv } from './PluginKv';

/** 插件设置读写面（与 `settings.panel` 同一份存储；由 `PluginHost.pluginSettingsAccess()` 提供） */
export interface PluginSettingsAccess {
  get(id: string, key: string): unknown;
  /** 非法值**抛错**（调用方据此回执失败） */
  set(id: string, key: string, value: unknown): void;
}

/** 可注入的系统件（缺省由 main/index.ts 用 electron 提供；单测传假件） */
export interface PluginSandboxApiDeps {
  http: HttpClient;
  logger: Logger;
  pluginsDir: string;
  settings: PluginSettingsAccess;
  kv: PluginKv;
  /** player.control 转发（main/index.ts 发给播放器窗口；未开返回 ok:false） */
  playerRelay: (op: PlayerOp, value?: unknown) => { ok: boolean; reason?: string };
  notify: (title: string, body: string) => void | Promise<void>;
  clipboardRead: () => string | Promise<string>;
  clipboardWrite: (text: string) => void | Promise<void>;
  dialogBox: (op: 'alert' | 'confirm', message: string, title?: string) => Promise<boolean | void>;
  openExternal: (url: string) => void | Promise<void>;
}

/** 拼接插件根目录并做**越界检查**（`rel` 必须落在 `<pluginsDir>/<id>.winbox/` 内） */
function safeJoin(root: string, rel: string): string {
  const r = String(rel ?? '').trim();
  if (r && !isSafeRelPath(r)) throw new Error(`越权路径：${r}`);
  const target = resolve(root, r);
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep)) throw new Error(`越权路径：${r}`);
  return target;
}

/** 从响应头取 `content-length`（无 → 0） */
function contentLength(headers: Record<string, string | string[]>): number {
  const raw = headers['content-length'] ?? headers['Content-Length'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function createPluginSandboxApi(deps: PluginSandboxApiDeps): PluginSandboxApi {
  const rootOf = (pluginId: string): string => join(deps.pluginsDir, `${pluginId}.winbox`);

  return {
    async http(pluginId: string, url: string, opts?: PluginHttpOpts) {
      const res = await deps.http.request({
        url,
        method: opts?.method ?? 'get',
        headers: opts?.headers,
        body: opts?.body,
        timeoutMs: opts?.timeoutMs,
        buffer: 0,
      });
      const content = typeof res.content === 'string' ? res.content : String(res.content ?? '');
      return { status: res.status, headers: res.headers, content };
    },

    /**
     * 下载落**插件目录**。
     * ★ v1 **非流式**：宿主 `HttpClient` 无流式接口 → `onProgress` 只报「开始(0,total) / 完成(bytes,bytes)」两帧
     *   （写入规范 §6.1 显式标注）。
     */
    async download(pluginId: string, url: string, name: string, onProgress: (loaded: number, total: number) => void) {
      const target = safeJoin(rootOf(pluginId), name);
      const res = await deps.http.request({ url, buffer: 1 });
      const raw = res.content;
      const bytes = Array.isArray(raw) ? Buffer.from(raw) : Buffer.from(String(raw ?? ''), 'utf-8');
      const total = contentLength(res.headers) || bytes.length;
      onProgress(0, total);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      onProgress(bytes.length, bytes.length);
      return { bytes: bytes.length };
    },

    kv(pluginId: string, op: 'get' | 'set' | 'delete', key: string, val?: string): string {
      if (op === 'get') return deps.kv.get(pluginId, key);
      if (op === 'set') {
        deps.kv.set(pluginId, key, val ?? '');
        deps.kv.flush();
        return '';
      }
      deps.kv.delete(pluginId, key);
      deps.kv.flush();
      return '';
    },

    settings(pluginId: string, op: 'get' | 'set', key: string, val?: unknown): unknown {
      if (op === 'get') return deps.settings.get(pluginId, key);
      deps.settings.set(pluginId, key, val);
      return true;
    },

    fs(pluginId: string, op: FsOp, rel: string, data?: string): unknown {
      const root = rootOf(pluginId);
      if (op === 'list') {
        const dir = rel ? safeJoin(root, rel) : root;
        if (!existsSync(dir)) return [];
        return readdirSync(dir, { withFileTypes: true }).map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
      }
      const target = safeJoin(root, rel);
      switch (op) {
        case 'read':
          return readFileSync(target, 'utf-8');
        case 'write':
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, data ?? '');
          return true;
        case 'exists':
          return existsSync(target);
        case 'delete':
          rmSync(target, { recursive: true, force: true });
          return true;
        case 'mkdir':
          mkdirSync(target, { recursive: true });
          return true;
        default:
          return undefined;
      }
    },

    log(pluginId: string, level: 'i' | 'w' | 'e', msg: string): void {
      const text = `plugin:${pluginId} ${msg}`;
      if (level === 'e') deps.logger.e(text);
      else if (level === 'w') deps.logger.w(text);
      else deps.logger.i(text);
    },

    async notify(_pluginId: string, title: string, body: string): Promise<void> {
      await deps.notify(title, body);
    },

    async clipboard(_pluginId: string, op: 'read' | 'write', text?: string): Promise<string> {
      if (op === 'read') return deps.clipboardRead();
      await deps.clipboardWrite(text ?? '');
      return '';
    },

    async dialog(_pluginId: string, op: 'alert' | 'confirm', message: string, title?: string): Promise<boolean | void> {
      return deps.dialogBox(op, message, title);
    },

    async player(_pluginId: string, op: PlayerOp, value?: unknown): Promise<{ ok: boolean; reason?: string }> {
      return deps.playerRelay(op, value);
    },

    async openExternal(_pluginId: string, url: string): Promise<void> {
      if (!/^https?:\/\//i.test(String(url ?? '').trim())) throw new Error(`openExternal 仅允许 http/https：${url}`);
      await deps.openExternal(url);
    },
  };
}
