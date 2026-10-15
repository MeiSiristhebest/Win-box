// src/main/plugin/PluginInstaller.ts
// `.winbox` 安装管线（主进程）：解包 → 包级校验 → **原子落盘** `plugins/<id>.winbox/`。
//   ① 解包复用 `subtitle/archive.extractArchiveEntries`（zip 分支；不引新依赖）；
//   ② 校验委托 `shared/pluginPackage.validatePluginPackage`（纯函数，可单测）；
//   ③ 落盘：先写 `<id>.winbox.tmp`（全量成功）→ rename 为正式目录；
//      覆盖安装时旧目录先 rename 到 `.bak`，新目录就位后再删 `.bak`；任一步失败回滚、只删 tmp。
// 事实源：docs/design/插件系统_设计方案.md §3.1 / §6。
// ★ 依赖注入（不 import electron）：目录由调用方传入，便于在单测里用临时目录跑真链路。

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { extractArchiveEntries, type ArchiveEntry } from '../subtitle/archive';
import { normalizeEntryName, validatePluginPackage } from '../../shared/pluginPackage';
import type { PluginManifest } from '../../shared/plugin';

export interface PluginInstallResult {
  ok: boolean;
  /** 成功时的插件 id */
  id?: string;
  /** 成功时的安装目录（`<pluginsDir>/<id>.winbox`） */
  dir?: string;
  manifest?: PluginManifest;
  reasonCode?: string;
  reason?: string;
}

const TMP_SUFFIX = '.winbox.tmp';
const BAK_SUFFIX = '.winbox.bak';

export class PluginInstaller {
  /** 解包器可注入（默认真实 zip 解包），便于单测构造解析失败路径 */
  constructor(
    private readonly pluginsDir: string,
    private readonly extract: (buf: Buffer) => Promise<ArchiveEntry[]> = extractArchiveEntries,
  ) {}

  /** 从 `.winbox` 字节安装（或覆盖安装）一个插件 */
  async install(buf: Buffer): Promise<PluginInstallResult> {
    let entries: ArchiveEntry[] = [];
    try {
      entries = await this.extract(buf);
    } catch {
      entries = [];
    }
    const v = validatePluginPackage(entries);
    if (!v.ok || !v.manifest) return { ok: false, reasonCode: v.reasonCode, reason: v.reason };

    const id = v.manifest.id;
    const finalDir = join(this.pluginsDir, `${id}.winbox`);
    const tmpDir = join(this.pluginsDir, `${id}${TMP_SUFFIX}`);
    const bakDir = join(this.pluginsDir, `${id}${BAK_SUFFIX}`);

    // ① 写临时目录（全量写成功前绝不触碰旧目录）
    try {
      mkdirSync(this.pluginsDir, { recursive: true });
      rmSync(tmpDir, { recursive: true, force: true });
      for (const e of entries) this.writeEntry(tmpDir, e);
    } catch (e) {
      rmSync(tmpDir, { recursive: true, force: true });
      return { ok: false, reasonCode: 'INSTALL_IO', reason: `写入插件目录失败：${msg(e)}` };
    }

    // ② 原子替换（旧目录先挪到 .bak，失败则挪回）
    let backedUp = false;
    try {
      if (existsSync(finalDir)) {
        rmSync(bakDir, { recursive: true, force: true });
        renameSync(finalDir, bakDir);
        backedUp = true;
      }
      renameSync(tmpDir, finalDir);
      rmSync(bakDir, { recursive: true, force: true });
    } catch (e) {
      rmSync(tmpDir, { recursive: true, force: true });
      if (backedUp && !existsSync(finalDir)) {
        try {
          renameSync(bakDir, finalDir);
        } catch {
          /* 回滚失败：保留 .bak 供人工恢复，不删 */
        }
      }
      return { ok: false, reasonCode: 'INSTALL_IO', reason: `替换插件目录失败：${msg(e)}` };
    }

    return { ok: true, id, dir: finalDir, manifest: v.manifest };
  }

  /** 写单条目；目录项跳过；目标必须落在 tmpDir 内（防路径逃逸兜底） */
  private writeEntry(tmpDir: string, e: ArchiveEntry): void {
    const name = normalizeEntryName(e.name);
    if (!name) return;
    const target = resolve(tmpDir, name);
    const root = resolve(tmpDir);
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`条目越界：${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.bytes);
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
