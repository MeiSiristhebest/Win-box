// src/shared/pluginPackage.ts
// `.winbox` **包级**校验（纯函数、零依赖、不含 electron/node）：
//   清单级约束由 `validatePluginManifest` 负责（§4.1）；本文件负责**包结构与随包文件**：
//     ① 根级必备 plugin.json（不得多套目录层）；
//     ② 全部条目名必须是安全相对路径；
//     ③ `contributes.mpv.shaders` 声明的着色器必须**真实随包**于 `files/<name>`。
// 事实源：docs/design/插件制作规范.md §3；设计文档 §3.1。
//
// ★ 与宿主契约一致：本文件不重复白名单/字段规则，一律**委托** validatePluginManifest。

import { validatePluginManifest, isSafeRelPath, type PluginManifest, type PluginReasonCode } from './plugin';

export type PackageReasonCode =
  | PluginReasonCode
  | 'EMPTY_PACKAGE'
  | 'UNSAFE_ENTRY_PATH'
  | 'MANIFEST_NOT_ROOT'
  | 'BAD_JSON'
  | 'MISSING_DECLARED_FILE';

export interface PackageEntry {
  /** 包内条目名（可含相对路径；`\` 与 `/` 均接受） */
  name: string;
  bytes: Uint8Array;
}

export interface PackageValidation {
  ok: boolean;
  reasonCode?: PackageReasonCode;
  reason?: string;
  manifest?: PluginManifest;
}

/** 归一化条目名：`\`→`/`、去掉前导 `./`；目录项（以 `/` 结尾）返回 '' 由调用方剔除 */
export function normalizeEntryName(raw: string): string {
  const s = String(raw ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return s.endsWith('/') ? '' : s;
}

/**
 * 校验 `.winbox` 包（**纯函数**）。entries = 解包产物（目录项可传入，会被忽略）。
 * 成功时返回 manifest（供安装器决定落盘目录名）。
 */
export function validatePluginPackage(entries: PackageEntry[]): PackageValidation {
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const e of entries ?? []) {
    const name = normalizeEntryName(e?.name ?? '');
    if (!name) continue; // 目录项 / 空名 → 剔除
    if (!isSafeRelPath(name)) return { ok: false, reasonCode: 'UNSAFE_ENTRY_PATH', reason: `包内条目路径非法：${e.name}` };
    files.push({ name, bytes: e.bytes });
  }
  if (!files.length) return { ok: false, reasonCode: 'EMPTY_PACKAGE', reason: '包内无有效文件（可能不是 zip / 已损坏）' };

  const manifestEntry = files.find((f) => f.name === 'plugin.json');
  if (!manifestEntry) {
    const nested = files.some((f) => f.name.endsWith('/plugin.json'));
    return {
      ok: false,
      reasonCode: 'MANIFEST_NOT_ROOT',
      reason: nested ? 'plugin.json 必须位于包根级，多套了一层目录' : '包内缺少根级 plugin.json',
    };
  }

  let manifest: unknown;
  try {
    const text = new TextDecoder('utf-8').decode(manifestEntry.bytes).replace(/^\uFEFF/, '');
    manifest = JSON.parse(text);
  } catch {
    return { ok: false, reasonCode: 'BAD_JSON', reason: 'plugin.json 不是合法 JSON' };
  }

  const v = validatePluginManifest(manifest);
  if (!v.ok) return { ok: false, reasonCode: v.reasonCode, reason: v.reason };
  const m = manifest as PluginManifest;

  // 声明的着色器必须真实随包（`files/<name>`）——清单级校验只保证"名字安全"，不保证"文件存在"。
  const present = new Set(files.map((f) => f.name));
  for (const c of m.contributes ?? []) {
    if (c?.type !== 'mpv.shaders') continue;
    for (const mode of c.modes ?? []) {
      for (const s of mode.shaders ?? []) {
        const rel = `files/${s}`;
        if (!present.has(rel)) {
          return { ok: false, reasonCode: 'MISSING_DECLARED_FILE', reason: `声明的着色器未随包：${rel}` };
        }
      }
    }
  }

  return { ok: true, manifest: m };
}
