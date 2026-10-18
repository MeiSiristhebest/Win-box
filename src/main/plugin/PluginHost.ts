import { registerPluginSkins } from '../../shared/ui/themeTokens';
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
import { dirname, join } from 'node:path';
import { JsonStore } from '../store/JsonStore';
import { PluginInstaller } from './PluginInstaller';
import { PluginRegistry, BUILTIN_MARKER, type PluginEntry } from './PluginRegistry';
import {
  danmakuSourceContributeOf, discoverSourceContributeOf, metaProviderContributeOf, shaderModes, shadersForMode,
  subtitleProviderContributeOf, themeContributeOf,
  validateDanmakuSourceContribute, validateDiscoverSourceContribute, validateKeymapContribute, validateLiveTemplateContribute,
  validateMetaProviderContribute, validatePlayerEngineContribute, validateSettingsPanelContribute, validateSubtitleProviderContribute, validateThemeContribute,
  validateUiCommandContribute, validateUiSlotContribute,
  settingsEffectiveValue, settingsValueError,
  type KeymapContribute, type KeymapView,
  type LiveTemplateContribute, type PlayerEngineContribute, type PlayerEngineView, type PluginInspectResult, type PluginView, type SettingsPanelContribute, type SettingsPanelView, type SettingsValue,
  type SrState, type ThemeSkinView, type UiCommandContribute, type UiCommandView, type UiSlotContribute, type UiSlotView,
} from '../../shared/plugin';
import { playerEngineFromContribute } from './pluginPlayerEngine';
import type { EngineLaunchSpec } from '../player/PlayerEngineController';
import { subtitleProviderFromContribute } from './pluginSubtitleProvider';
import { metaProviderFromContribute, type MetaProvider } from './pluginMetaProvider';
import { discoverSourceFromContribute, type DiscoverSource } from './pluginDiscoverSource';
import { danmakuSourceFromContribute, type DanmakuSource } from './pluginDanmakuSource';
import { liveTemplateFromContribute, type LiveTemplate } from './pluginLiveTemplate';
import { uiCommandFromContribute } from './pluginUiCommand';
import { keymapFromContribute } from './pluginKeymap';
import { settingsPanelFromContribute } from './pluginSettingsPanel';
import { uiSlotFromContribute } from './pluginUiSlot';
import type { SubtitleProvider } from '../subtitle/provider';
import { srModeUsable } from '../../shared/player';
import { PluginSandboxManager, type SandboxEntry } from './sandbox/PluginSandboxManager';
import type { PluginSandboxApi } from './sandbox/protocol';
import type { PluginSettingsAccess } from './pluginHostApi';
import type { Logger } from '../../shared/types';

export interface PluginOpResult {
  ok: boolean;
  reason?: string;
  items?: PluginView[];
}

/** ★ 写插件设置字段的结果（成功时带上**最新面板列表**，渲染层据此收敛） */
export interface PluginSettingResult {
  ok: boolean;
  reason?: string;
  panels?: SettingsPanelView[];
}

interface HostOptions {
  pluginsDir: string;
  builtinDir: string;
  /** 启停状态持久化文件（默认 `<pluginsDir>/../plugins-state.json` 由调用方给出） */
  statePath: string;
  /** ★ 插件设置面板值的持久化文件（缺省 = 与 `statePath` 同目录的 `plugin-settings.json`） */
  settingsPath?: string;
  /**
   * ★ R11：`local-path` 引擎的**用户本机路径**来源（`engine:<contributeId> → 路径`）。
   * 缺省 = 空表（未接入 → 一律「未指定本机程序路径」）；由 `main/index.ts` 注入 `playerSettings.enginePaths`。
   */
  enginePaths?: () => Record<string, string>;
}

export class PluginHost {
  private readonly installer: PluginInstaller;
  private readonly registry: PluginRegistry;
  private readonly state: JsonStore;
  /** ★ 插件设置面板值（按插件 id → panelId → fieldKey 分桶；`contributes.settings.panel`） */
  private readonly settings: JsonStore;
  private entries: PluginEntry[] = [];
  private loaded = false;
  /** ★ R10：L4 沙箱管理器（未接入 → `kind:"code"` 插件不启动，`PluginView.sandbox` 恒 undefined） */
  private sandbox: PluginSandboxManager | null = null;

  constructor(private readonly opts: HostOptions) {
    this.installer = new PluginInstaller(opts.pluginsDir);
    this.registry = new PluginRegistry(opts.pluginsDir, opts.builtinDir);
    this.state = new JsonStore(opts.statePath);
    this.settings = new JsonStore(opts.settingsPath ?? join(dirname(opts.statePath), 'plugin-settings.json'));
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
    await this.ensureLoaded();
    // ★ R10：启停直接影响 L4 沙箱生命周期 → 立刻与登记表对齐（启 → 起沙箱 / 停 → 释放）
    await this.syncSandboxes();
    await this.themeSkins();
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
    registerPluginSkins(out);
    return out;
  }

  /**
   * ★ 插件字幕源（`contributes.subtitle.provider`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 SubtitleProvider。
   * 同 id **先到先得**（内置源 id 已在安装校验期由 `SUBTITLE_ID_TAKEN` 拦掉，不在此重复）。
   * 规范：docs/design/插件制作规范.md §5（L2 声明式 provider）。
   */
  async subtitleProviders(): Promise<SubtitleProvider[]> {
    await this.ensureLoaded();
    const out: SubtitleProvider[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      const c = subtitleProviderContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateSubtitleProviderContribute(c).ok) continue; // 安装期已校验，这里兜一道
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(subtitleProviderFromContribute(c));
    }
    return out;
  }

  /**
   * ★ 插件元数据源（`contributes.meta.provider`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 MetaProvider。
   * 同 id **先到先得**（内置 `tmdb`/`douban` id 已在安装校验期由 `META_ID_TAKEN` 拦掉）。
   * 规范：docs/design/插件制作规范.md §5.5。
   */
  async metaProviders(): Promise<MetaProvider[]> {
    await this.ensureLoaded();
    const out: MetaProvider[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      const c = metaProviderContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateMetaProviderContribute(c).ok) continue; // 安装期已校验，这里兜一道
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(metaProviderFromContribute(c));
    }
    return out;
  }

  /**
   * ★ 插件发现页数据源（`contributes.discover.source`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 DiscoverSource。
   * 同 id **先到先得**。规范：docs/design/插件制作规范.md §5.6。
   */
  async discoverSources(): Promise<DiscoverSource[]> {
    await this.ensureLoaded();
    const out: DiscoverSource[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      const c = discoverSourceContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateDiscoverSourceContribute(c).ok) continue; // 安装期已校验，这里兜一道
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(discoverSourceFromContribute(c));
    }
    return out;
  }

  /**
   * ★ 插件弹幕源（`contributes.danmaku.source`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 DanmakuSource。
   * 同 id **先到先得**（合成键 `plugin:<contributeId>` 供三步链路路由）。规范：docs/design/插件制作规范.md §5.7。
   */
  async danmakuSources(): Promise<DanmakuSource[]> {
    await this.ensureLoaded();
    const out: DanmakuSource[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      const c = danmakuSourceContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateDanmakuSourceContribute(c).ok) continue; // 安装期已校验，这里兜一道
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(danmakuSourceFromContribute(c));
    }
    return out;
  }

  /**
   * ★ 插件直播输出模板（`contributes.live.template`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 LiveTemplate。
   * ★ 本类型**不发请求** —— 只把宿主已解析的直播频道格式化输出；**一个插件可声明多个模板**（各自独立 id），
   *   同 id **先到先得**（含跨插件）。规范：docs/design/插件制作规范.md §5.8。
   */
  async liveTemplates(): Promise<LiveTemplate[]> {
    await this.ensureLoaded();
    const out: LiveTemplate[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'live.template') continue;
        const c = raw as unknown as LiveTemplateContribute;
        if (!validateLiveTemplateContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({ ...liveTemplateFromContribute(c), pluginId: e.id });
      }
    }
    return out;
  }

  /**
   * ★ 插件受限动作按钮（`contributes.ui.command`）：已启用 + 载荷就位 + 通过内容校验 → 摊平成 `UiCommandView`。
   * ★ 本类型**不取数、不跑代码** —— 主进程只做「校验 + 装配」，动作由**渲染层**按词表执行；同 id **先到先得**。
   * 规范：docs/design/插件制作规范.md §5.9。
   */
  async uiCommands(): Promise<UiCommandView[]> {
    await this.ensureLoaded();
    const out: UiCommandView[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'ui.command') continue;
        const c = raw as unknown as UiCommandContribute;
        if (!validateUiCommandContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(uiCommandFromContribute(c, { id: e.id, name: e.manifest.name }));
      }
    }
    return out;
  }

  /**
   * ★ 插件快捷键（`contributes.keymap`）：已启用 + 载荷就位 + 通过内容校验 → 摊平成 `KeymapView`
   * （键位串归一到规范形式，如 `Ctrl+Alt+F`）。★ 本类型**不跑代码、不取数** —— 主进程只做「校验 + 装配」，
   * 动作由**渲染层**按 `ui.command` **同一套词表**执行；同 id **先到先得**。规范：§5.10。
   */
  async keymaps(): Promise<KeymapView[]> {
    await this.ensureLoaded();
    const out: KeymapView[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'keymap') continue;
        const c = raw as unknown as KeymapContribute;
        if (!validateKeymapContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(keymapFromContribute(c, { id: e.id, name: e.manifest.name }));
      }
    }
    return out;
  }

  /**
   * ★ 插件设置面板（`contributes.settings.panel`）：已启用 + 载荷就位 + 通过内容校验 → 摊平成 `SettingsPanelView`
   * （含**有效值** = 存值合法则用存值、否则回落 `default`）。★ 本类型**不跑代码、不取数** —— 主进程只做
   * 「校验 + 装配 + **代持久化**」，表单渲染与写回由**渲染层**完成；同 id **先到先得**。规范：§5.11。
   * ★ 值的**读取面留给 L4**（`kind:"code"` + `settings` 权限 → `winbox.settings`）；asset 插件自身不读。
   */
  async settingsPanels(): Promise<SettingsPanelView[]> {
    await this.ensureLoaded();
    const out: SettingsPanelView[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      const stored = this.settings.getObject<Record<string, Record<string, unknown>>>(e.id, {});
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'settings.panel') continue;
        const c = raw as unknown as SettingsPanelContribute;
        if (!validateSettingsPanelContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(settingsPanelFromContribute(c, { id: e.id, name: e.manifest.name }, stored[c.id]));
      }
    }
    return out;
  }

  /**
   * ★ 写一个设置字段值（渲染层表单 onChange → IPC）：值必须过**该字段的类型 / 约束**校验
   * （不合法 → **明确失败**，不静默强转），通过后按 `pluginId → panelId → fieldKey` 分桶持久化。
   * 返回最新的面板列表（渲染层据此收敛）。
   */
  async setPluginSetting(a: { id?: unknown; panelId?: unknown; key?: unknown; value?: unknown }): Promise<PluginSettingResult> {
    await this.ensureLoaded();
    const id = String(a?.id ?? ''), panelId = String(a?.panelId ?? ''), key = String(a?.key ?? '');
    if (!id || !panelId || !key) return { ok: false, reason: '参数不完整' };
    const e = this.entries.find((x) => x.id === id);
    if (!e || !this.enabled(e.id) || !e.payloadReady || !isDirPath(e.path)) return { ok: false, reason: '插件不存在或未启用' };
    const panel = (e.manifest.contributes ?? []).find(
      (x) => x?.type === 'settings.panel' && (x as { id?: unknown }).id === panelId,
    ) as unknown as SettingsPanelContribute | undefined;
    if (!panel || !validateSettingsPanelContribute(panel).ok) return { ok: false, reason: '设置面板不存在' };
    const field = panel.fields.find((f) => f.key === key);
    if (!field) return { ok: false, reason: `未知设置项：${key}` };
    const err = settingsValueError(field, a.value);
    if (err) return { ok: false, reason: `${field.label}：${err}` };
    const all = this.settings.getObject<Record<string, Record<string, unknown>>>(e.id, {});
    const bucket = { ...all[panelId], [key]: a.value as SettingsValue };
    this.settings.setObject(e.id, { ...all, [panelId]: bucket });
    this.settings.flush();
    return { ok: true, panels: await this.settingsPanels() };
  }

  /**
   * ★ 插件受限 UI 槽位（`contributes.ui.slot`）：已启用 + 载荷就位 + 通过内容校验 → 摊平成 `UiSlotView`。
   * ★ 本类型**不跑代码、不取数** —— 主进程只做「校验 + 装配」，组件树渲染在渲染层
   * （`components/PluginSlot.tsx`，按页面语义名落到对应槽位）；同 id **先到先得**。规范：§5.12。
   */
  async uiSlots(): Promise<UiSlotView[]> {
    await this.ensureLoaded();
    const out: UiSlotView[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'ui.slot') continue;
        const c = raw as unknown as UiSlotContribute;
        if (!validateUiSlotContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(uiSlotFromContribute(c, { id: e.id, name: e.manifest.name }));
      }
    }
    return out;
  }

  /**
   * ★ R11 第三方播放内核（`contributes.player.engine`）：已启用 + `kind:"code"` + 载荷就位 + 通过内容校验
   * → 摊平成 `PlayerEngineView`（**含 exe 就绪判定**：`plugin-file` 落在插件目录内 / `local-path` 取用户配置）。
   * ★ 未就绪**仍出现在列表里**（`ready:false` + `note`），由渲染层显示为不可选 + 原因；同 id **先到先得**。
   * ★ 插件**永不拉进程** —— 本方法只解析「用哪个 exe」，实际 spawn 在 `PlayerEngineController`（宿主）。
   * 规范：docs/design/插件制作规范.md §6.3。
   */
  async playerEngines(): Promise<PlayerEngineView[]> {
    await this.ensureLoaded();
    const paths = this.enginePaths();
    const out: PlayerEngineView[] = [];
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (e.manifest.kind !== 'code') continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'player.engine') continue;
        const c = raw as unknown as PlayerEngineContribute;
        if (!validatePlayerEngineContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(playerEngineFromContribute(
          c,
          { id: e.id, name: e.manifest.name, dir: e.path },
          paths[`engine:${c.id}`] ?? '',
        ));
      }
    }
    return out;
  }

  /**
   * ★ R11：按 `engine:<contributeId>` 取**启动规格**（已就绪的 exe + **未展开**参数模板 + 协议）。
   * 未启用 / 未就绪 / 未知 / 校验不过 → `null`（由 `engine:start` 明确上屏原因）。
   * ★ 返回的 `exe` 已解析、`args` 仍是模板（占位符展开由 `PlayerEngineController` 按会话上下文完成）。
   */
  async playerEngineSpec(id: string): Promise<EngineLaunchSpec | null> {
    await this.ensureLoaded();
    const want = String(id || '');
    const paths = this.enginePaths();
    for (const e of this.entries) {
      if (!this.enabled(e.id)) continue;
      if (e.manifest.kind !== 'code') continue;
      if (!e.payloadReady || !isDirPath(e.path)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'player.engine') continue;
        const c = raw as unknown as PlayerEngineContribute;
        if (`engine:${c.id}` !== want) continue;
        if (!validatePlayerEngineContribute(c).ok) return null;
        const view = playerEngineFromContribute(
          c,
          { id: e.id, name: e.manifest.name, dir: e.path },
          paths[`engine:${c.id}`] ?? '',
        );
        if (!view.ready || !view.path) return null;
        return { id: want, exe: view.path, args: [...(c.args ?? [])], protocol: c.protocol };
      }
    }
    return null;
  }

  // ---- ★ R10：L4 沙箱（`kind:"code"`）----

  /**
   * 接入 L4 沙箱管理器（由 `main/index.ts` 调用；**不接入 → code 插件不启动**）。
   * 注入 `workerFile`（`dist/plugin-worker.cjs`）与宿主能力面；`factory` 供单测注入假件。
   */
  attachSandbox(deps: {
    api: PluginSandboxApi;
    workerFile: string;
    logger: Logger;
    factory?: ConstructorParameters<typeof PluginSandboxManager>[0]['factory'];
  }): void {
    this.sandbox = new PluginSandboxManager({
      api: deps.api,
      workerFile: deps.workerFile,
      logger: deps.logger,
      factory: deps.factory,
    });
  }

  /**
   * 沙箱 `settings` 读写面（与 `contributes.settings.panel` **同一份存储**）。
   * `get` 按 field.key 定位并返回**有效值**（存值合法则存值、否则 `default`）；`set` 过类型校验（不合法**抛**）。
   */
  pluginSettingsAccess(): PluginSettingsAccess {
    const findField = (id: string, key: string): { panelId: string; field: SettingsPanelContribute['fields'][number] } | undefined => {
      const e = this.entries.find((x) => x.id === id);
      if (!e) return undefined;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'settings.panel') continue;
        const c = raw as unknown as SettingsPanelContribute;
        if (!validateSettingsPanelContribute(c).ok) continue;
        const f = c.fields.find((x) => x.key === key);
        if (f) return { panelId: c.id, field: f };
      }
      return undefined;
    };
    return {
      get: (id: string, key: string): unknown => {
        const found = findField(id, key);
        if (!found) return undefined;
        const stored = this.settings.getObject<Record<string, Record<string, unknown>>>(id, {});
        return settingsEffectiveValue(found.field, stored[found.panelId]?.[key]);
      },
      set: (id: string, key: string, value: unknown): void => {
        const e = this.entries.find((x) => x.id === id);
        if (!e) throw new Error('插件不存在');
        const found = findField(id, key);
        if (!found) throw new Error(`未知设置项：${key}`);
        const err = settingsValueError(found.field, value);
        if (err) throw new Error(`${found.field.label}：${err}`);
        const all = this.settings.getObject<Record<string, Record<string, unknown>>>(id, {});
        const bucket = { ...all[found.panelId], [key]: value as SettingsValue };
        this.settings.setObject(id, { ...all, [found.panelId]: bucket });
        this.settings.flush();
      },
    };
  }

  /**
   * ★ R10 安装前**干跑**：解包 + 校验但**不落盘**，返回权限清单（含 `permissionNotes`）供用户确认。
   * 确认后由渲染层把 `path` 回传给 `installFromFile`。
   */
  async inspect(filePath: string): Promise<PluginInspectResult> {
    let buf: Buffer;
    try {
      buf = readFileSync(filePath);
    } catch {
      return { ok: false, reason: '读取所选文件失败' };
    }
    const r = await this.installer.inspect(buf);
    if (!r.ok || !r.manifest) return { ok: false, reason: r.reason || r.reasonCode || '插件包不合法', reasonCode: r.reasonCode };
    const m = r.manifest;
    return {
      ok: true,
      path: filePath,
      id: m.id,
      name: m.name,
      version: m.version,
      kind: m.kind,
      permissions: m.permissions ?? [],
      permissionNotes: m.permissionNotes ?? {},
    };
  }

  /** 释放全部 L4 沙箱（应用退出时调用） */
  dispose(): void {
    this.sandbox?.disposeAll();
  }

  /** 与登记表对齐：启用 + code + 载荷就位 → 确保在跑；其余释放 */
  private async syncSandboxes(): Promise<void> {
    if (!this.sandbox) return;
    const list: SandboxEntry[] = this.entries.map((e) => ({
      id: e.id,
      enabled: this.enabled(e.id),
      kind: e.manifest.kind,
      payloadReady: e.payloadReady && isDirPath(e.path),
      path: join(this.opts.pluginsDir, `${e.id}.winbox`),
      main: e.manifest.main,
      permissions: e.manifest.permissions ?? [],
    }));
    await this.sandbox.sync(list);
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
    await this.themeSkins();
    // ★ R10：登记表每次刷新后与 L4 沙箱**幂等对齐**（该跑的在跑、不该跑的释放）
    await this.syncSandboxes();
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.refresh();
  }

  private view(e: PluginEntry): PluginView {
    // ★ R10：code 插件恒带沙箱状态（未启动 / 已释放 → `{ running: false }`；asset → undefined）
    const sandbox =
      e.manifest.kind === 'code' && this.sandbox ? this.sandbox.stateOf(e.id) ?? { running: false } : undefined;
    return {
      id: e.id,
      name: e.manifest.name,
      version: e.manifest.version,
      source: e.source,
      level: e.level,
      kind: e.manifest.kind,
      permissions: e.manifest.permissions ?? [],
      sandbox,
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

  /** ★ R11：`local-path` 引擎的用户路径表（未接入 / 读取失败 → 空表） */
  private enginePaths(): Record<string, string> {
    try {
      const m = this.opts.enginePaths?.();
      return m && typeof m === 'object' ? m : {};
    } catch {
      return {};
    }
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
