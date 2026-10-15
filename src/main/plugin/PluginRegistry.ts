// src/main/plugin/PluginRegistry.ts
// 插件**登记表**（主进程）：汇总两类来源，供管理器与 MPV 注入消费。
//   - `user`   ：用户安装的 `<pluginsDir>/<id>.winbox/` 目录（已在磁盘、载荷可直接按绝对路径取用）；
//   - `builtin`：随包的 `resources/plugins/<id>.winbox`（**只读 zip**，登记期只读其清单，
//                载荷尚未物化为文件 —— 何时物化由后续"MPV 注入接线"决定）。
// 冲突规则：同一 id 同时存在时 **user 覆盖 builtin**（用户装了自己的版本即以用户的为准）。
// 事实源：docs/design/插件系统_设计方案.md §6.1 / §7.1。
// ★ 依赖注入（不 import electron）：两个目录由调用方传入，便于单测。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractArchiveEntries } from '../subtitle/archive';
import { validatePluginManifest, pluginLevelOf, type PluginManifest, type PluginLevel } from '../../shared/plugin';
import { validatePluginPackage } from '../../shared/pluginPackage';

export type PluginEntrySource = 'builtin' | 'user';

/** 物化后的随包插件侧签（存在即视为 builtin 源；见 PluginHost） */
export const BUILTIN_MARKER = '.builtin.json';

export interface PluginEntry {
  id: string;
  source: PluginEntrySource;
  manifest: PluginManifest;
  level: PluginLevel;
  /** user：已安装目录绝对路径；builtin：随包 `.winbox` 绝对路径 */
  path: string;
  /** 载荷是否已物化为可访问文件（user=true；builtin 登记期为 false） */
  payloadReady: boolean;
}

export class PluginRegistry {
  constructor(
    private readonly pluginsDir: string,
    private readonly builtinDir: string,
    private readonly extract: (buf: Buffer) => Promise<Array<{ name: string; bytes: Buffer }>> = extractArchiveEntries,
  ) {}

  /** 汇总全部**可登记**插件（清单校验通过者）；重复 id 时 user 优先 */
  async list(): Promise<PluginEntry[]> {
    const byId = new Map<string, PluginEntry>();
    for (const e of await this.listBuiltin()) byId.set(e.id, e);
    for (const e of this.listUser()) byId.set(e.id, e); // user 覆盖 builtin
    return [...byId.values()];
  }

  /** 已安装（user）插件：扫 `<pluginsDir>/*.winbox/` 目录 */
  private listUser(): PluginEntry[] {
    const out: PluginEntry[] = [];
    for (const name of safeReaddir(this.pluginsDir)) {
      if (!name.endsWith('.winbox')) continue;
      const dir = join(this.pluginsDir, name);
      if (!isDir(dir)) continue;
      const m = readManifestFile(join(dir, 'plugin.json'));
      if (!m) continue;
      // ★ 随包官方插件被**物化**（解包）到 pluginsDir 后带 `.builtin.json` 侧签 → 仍登记为 builtin
      //   （见 PluginHost.materializeBuiltin；用户自己安装的同 id 会整体替换该目录、侧签一并消失 → 归为 user）
      const builtin = existsSync(join(dir, BUILTIN_MARKER));
      out.push(entry(m, builtin ? 'builtin' : 'user', dir, true));
    }
    return out;
  }

  /**
   * 随包（builtin）插件：扫 `<builtinDir>/*.winbox` 只读 zip，登记期只读清单。
   * ★ 单独暴露（不经 `list()` 的去重）：`PluginHost.materializeBuiltin` 需要看到**随包 zip 的版本**，
   *   而物化后的同名目录会在 `list()` 里把 zip 条目覆盖掉。
   */
  async listBuiltin(): Promise<PluginEntry[]> {
    const out: PluginEntry[] = [];
    for (const name of safeReaddir(this.builtinDir)) {
      if (!name.endsWith('.winbox')) continue;
      const file = join(this.builtinDir, name);
      if (isDir(file)) continue;
      let entries: Array<{ name: string; bytes: Buffer }> = [];
      try {
        entries = await this.extract(readFileSync(file));
      } catch {
        entries = [];
      }
      const v = validatePluginPackage(entries);
      if (!v.ok || !v.manifest) continue;
      out.push(entry(v.manifest, 'builtin', file, false));
    }
    return out;
  }
}

function entry(m: PluginManifest, source: PluginEntrySource, path: string, payloadReady: boolean): PluginEntry {
  return { id: m.id, source, manifest: m, level: pluginLevelOf(m), path, payloadReady };
}

/** 读单个已安装目录的清单（缺失/非法 → null） */
function readManifestFile(p: string): PluginManifest | null {
  try {
    const m = JSON.parse(readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')) as unknown;
    const v = validatePluginManifest(m);
    return v.ok ? (m as PluginManifest) : null;
  } catch {
    return null;
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return existsSync(dir) ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
