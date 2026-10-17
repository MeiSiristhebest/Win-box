// src/main/plugin/PluginHost.ts
// 插件宿主（主进程侧聚合层）：登记 / 物化 / 安装 / 卸载 / 启停 + **超分着色器链解析**。
//
// ★ 随包官方插件（`resources/plugins/*.winbox`）在启动时**物化**（解包）到 `<pluginsDir>/<id>.winbox/`
//   并写 `.builtin.json` 侧签 —— 方案 A（2026-10-16 用户定）：磁盘布局与用户安装**完全同构**，
//   ⑤/⑥ 的绝对路径逻辑只有一套；随软件更新（随包版本变化）时重新物化。
//   若用户自己装了同 id（目录无侧签）→ **尊重用户**，不覆盖。
//
// ★ 渲染层只报「档位」，**绝对路径全在主进程解析**（渲染层不碰文件系统）：见 srShaders。
// 事实源：docs/design/插件系统_设计方案.md §6.1 / §8。
// ★ 依赖注入（不 import electron）：三个路径由调用方传入，便于单测。

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonStore } from '../store/JsonStore';
import { PluginInstaller } from './PluginInstaller';
import { PluginRegistry, BUILTIN_MARKER, type PluginEntry } from './PluginRegistry';
import {
  shaderModes, shadersForMode, themeContributeOf, validateThemeContribute,
  type PluginView, type SrState, type ThemeSkinView,
} from '../../shared/plugin';
import { srModeUsable } from '../../shared/player';

export interface PluginOpResult {
  ok: boolean;
  reason?: string;
  items?: PluginView[];
}

interface HostOptions {
  pluginsDir: string;
  builtinDir: string;
  /** 启停状态持久化文件（默认 `<pluginsDir>/../plugins-state.json` 由调用方给出） */
  statePath: string;
}

export class PluginHost {
  private readonly installer: PluginInstaller;
  private readonly registry: PluginRegistry;
  private readonly state: JsonStore;
  private entries: PluginEntry[] = [];
  private loaded = false;

  constructor(private readonly opts: HostOptions) {
    this.installer = new PluginInstaller(opts.pluginsDir);
    this.registry = new PluginRegistry(opts.pluginsDir, opts.builtinDir);
    this.state = new JsonStore(opts.statePath);
  }

  /** 启动：物化随包插件 → 刷新登记表 */
  async init(): Promise<void> {
    try {
      await this.materializeBuiltin();
    } catch {
      /* 物化失败不阻塞启动：该插件保持「载荷未就绪」 */
    }
    await this.refresh();
  }

  /** 已登记插件（user 目录 + builtin）；重复 id 时 user 覆盖 builtin */
  async list(): Promise<PluginView[]> {
    await this.ensureLoaded();
    return this.entries.map((e) => this.view(e));
  }

  /** 安装 `.winbox`（文件路径）；成功后返回新表 */
  async installFromFile(filePath: string): Promise<PluginOpResult> {
    let buf: Buffer;
    try {
      buf = readFileSync(filePath);
    } catch {
      return { ok: false, reason: '读取所选文件失败' };
    }
    const r = await this.installer.install(buf);
    if (!r.ok) return { ok: false, reason: r.reason || r.reasonCode || '安装失败' };
    // 用户装了自己的版本 → 清掉旧侧签（若同名 builtin 曾物化过），避免被误登记为 builtin
    if (r.dir) {
      try {
        rmSync(join(r.dir, BUILTIN_MARKER), { force: true });
      } catch {
        /* ignore */
      }
    }
    await this.refresh();
    return { ok: true, items: await this.list() };
  }

  /** 卸载：删 `<id>.winbox/`（含 .tmp/.bak 残留）与启停记录 */
  async uninstall(id: string): Promise<PluginOpResult> {
    const base = join(this.opts.pluginsDir, id);
    for (const suffix of ['.winbox', '.winbox.tmp', '.winbox.bak']) {
      try {
        rmSync(base + suffix, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    this.setDisabled(this.disabled().filter((x) => x !== id));
    await this.refresh();
    return { ok: true, items: await this.list() };
  }

  /** 启停整插件（停用保留磁盘、只不参与宿主装配） */
  async setEnabled(id: string, on: boolean): Promise<PluginOpResult> {
    const cur = this.disabled();
    const next = on ? cur.filter((x) => x !== id) : cur.includes(id) ? cur : [...cur, id];
    this.setDisabled(next);
    return { ok: true, items: await this.list() };
  }

  /** 超分状态（可选档位 + 实际生效档位） */
  async srState(wanted: unknown): Promise<SrState> {
    const e = await this.srPlugin();
    const modes = e ? this.modesOf(e) : [];
    return {
      available: modes.length > 0,
      modes,
      mode: srModeUsable(wanted, modes.map((m) => m.id)),
    };
  }

  /** 某档位 → **绝对路径**着色器链（顺序即生效顺序）；未就绪 / `off` → 空数组 */
  async srShaders(mode: unknown): Promise<string[]> {
    const e = await this.srPlugin();
    if (!e) return [];
    const eff = srModeUsable(mode, this.modesOf(e).map((m) => m.id));
    if (eff === 'off') return [];
    return shadersForMode(e.manifest.contributes, 'mpv.shaders', eff)
      .map((n) => join(e.path, 'files', n))
      .filter((p) => existsSync(p));
  }

  /** 当前可用档位（供配置页/播放器显示） */
  async srModes(): Promise<Array<{ id: string; label: string }>> {
    const e = await this.srPlugin();
    return e ? this.modesOf(e) : [];
  }

  /**
   * ★ 插件皮肤（`contributes.theme`）：已启用 + 载荷就位 + 通过内容校验。
   * `id` 已带 `plugin:` 前缀 —— 渲染层**直接拿它作 `data-theme`**。
   * 规范：docs/design/皮肤与主题规范.md（令牌词表 / layout / 校验）。
   */
  async themeSkins(): Promise<ThemeSkinView[]> {
    await this.ensureLoaded();
    const out: ThemeSkinView[] = [];
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      const c = themeContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateThemeContribute(c).ok) continue; // 安装期已校验，这里兜一道
      out.push({
        id: `plugin:${c.id}`,
        pluginId: e.id,
        label: c.label,
        base: c.base,
        tokens: c.tokens,
        layout: c.layout ?? {},
      });
    }
    return out;
  }

  // ---- 内部 ----

  /** 物化随包插件：随包 zip → `<pluginsDir>/<id>.winbox/` + `.builtin.json` 侧签 */
  private async materializeBuiltin(): Promise<void> {
    // ★ 必须用 listBuiltin()（不经 list() 的去重）——物化后的同名目录会在 list() 里把随包 zip 覆盖掉，
    //   那样就看不到"随包版本变了"这件事，永远不会重新物化。
    const packaged = await this.registry.listBuiltin();
    for (const e of packaged) {
      // payloadReady=false 且 source=builtin ⇒ 仍是随包只读 zip，尚未物化
      if (e.source !== 'builtin' || e.payloadReady) continue;
      const zipPath = e.path;
      if (!existsSync(zipPath)) continue;
      const installedDir = join(this.opts.pluginsDir, `${e.id}.winbox`);
      const hasMarker = existsSync(join(installedDir, BUILTIN_MARKER));
      // 用户自己的同 id 安装（无侧签）→ 不覆盖
      if (existsSync(installedDir) && !hasMarker) continue;
      if (hasMarker && readMarkerVersion(installedDir) === e.manifest.version) continue; // 已是本版
      const r = await this.installer.install(readFileSync(zipPath));
      if (!r.ok || !r.dir) continue;
      try {
        writeFileSync(
          join(r.dir, BUILTIN_MARKER),
          JSON.stringify({ version: e.manifest.version, materializedAt: Date.now() }, null, 2),
        );
      } catch {
        /* 侧签写失败：下次启动会重复物化（幂等） */
      }
    }
  }

  private async refresh(): Promise<void> {
    this.entries = await this.registry.list();
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.refresh();
  }

  private view(e: PluginEntry): PluginView {
    return {
      id: e.id,
      name: e.manifest.name,
      version: e.manifest.version,
      source: e.source,
      level: e.level,
      enabled: this.enabled(e.id),
      ready: e.payloadReady && isDirPath(e.path),
      modes: this.modesOf(e),
    };
  }

  private modesOf(e: PluginEntry): Array<{ id: string; label: string }> {
    return shaderModes(e.manifest.contributes, 'mpv.shaders').map((m) => ({ id: m.id, label: m.label }));
  }

  /** 承担超分的那一个插件（已启用 + 载荷已就位 + 声明了 mpv.shaders 档位） */
  private async srPlugin(): Promise<PluginEntry | null> {
    await this.ensureLoaded();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      if (shaderModes(e.manifest.contributes, 'mpv.shaders').length) return e;
    }
    return null;
  }

  private enabled(id: string): boolean {
    return !this.disabled().includes(id);
  }

  private disabled(): string[] {
    const v = this.state.getObject<{ disabled?: unknown }>('plugins', {});
    return Array.isArray(v.disabled) ? v.disabled.filter((x): x is string => typeof x === 'string') : [];
  }

  private setDisabled(ids: string[]): void {
    this.state.setObject('plugins', { disabled: ids });
    this.state.flush();
  }
}

function readMarkerVersion(dir: string): string {
  try {
    const m = JSON.parse(readFileSync(join(dir, BUILTIN_MARKER), 'utf-8')) as { version?: unknown };
    return typeof m.version === 'string' ? m.version : '';
  } catch {
    return '';
  }
}

function isDirPath(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
