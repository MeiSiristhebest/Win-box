import { registerPluginSkins } from '../../shared/ui/themeTokens';
// src/main/plugin/PluginHost.ts
// 插件生命周期编排：登记 / 安装 / 卸载 / 启停，并把贡献项交给独立目录服务。
//
// ★ 随包官方插件（`resources/plugins/*.winbox`）在启动时**物化**（解包）到 `<pluginsDir>/<id>.winbox/`
//   并写 `.builtin.json` 侧签 —— 方案 A（2026-10-16 用户定）：磁盘布局与用户安装**完全同构**，
//   ⑤/⑥ 的绝对路径逻辑只有一套；随软件更新（随包版本变化）时重新物化。
//   若用户自己装了同 id（目录无侧签）→ **尊重用户**，不覆盖。
//
// ★ 渲染层只报「档位」，**绝对路径全在主进程解析**（渲染层不碰文件系统）：见 srShaders。
// 事实源：docs/design/插件系统_设计方案.md §6.1 / §8。
// ★ 依赖注入（不 import electron）：三个路径由调用方传入，便于单测。

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JsonStore } from '../store/JsonStore';
import { PluginInstaller } from './PluginInstaller';
import { PluginContributionCatalog } from './PluginContributionCatalog';
import { PluginSettingsService } from './PluginSettingsService';
import { createBuiltinPluginMaterializer } from './BuiltinPluginMaterializer';
import { PluginRegistry, BUILTIN_MARKER, type PluginEntry } from './PluginRegistry';
import type {
  KeymapView,
  PlayerEngineView,
  PluginInspectResult,
  PluginView,
  SettingsPanelView,
  SrState,
  ThemeSkinView,
  UiCommandView,
  UiSlotView,
} from '../../shared/plugin';
import type { EngineLaunchSpec } from '../player/PlayerEngineController';
import type { MetaProvider } from './pluginMetaProvider';
import type { DiscoverSource } from './pluginDiscoverSource';
import type { DanmakuSource } from './pluginDanmakuSource';
import type { LiveTemplate } from './pluginLiveTemplate';
import type { SubtitleProvider } from '../subtitle/provider';
import { PluginSandboxLifecycle, type SandboxEntry } from './sandbox/PluginSandboxLifecycle';
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
  private readonly contributions: PluginContributionCatalog;
  private readonly builtinMaterializer: ReturnType<typeof createBuiltinPluginMaterializer>;
  private readonly state: JsonStore;
  /** ★ 插件设置面板值（按插件 id → panelId → fieldKey 分桶；`contributes.settings.panel`） */
  private readonly settings: JsonStore;
  private readonly pluginSettings: PluginSettingsService;
  private entries: PluginEntry[] = [];
  private loaded = false;
  private refreshGeneration = 0;
  private refreshTask: Promise<void> | undefined;
  /** ★ R10：L4 沙箱管理器（未接入 → `kind:"code"` 插件不启动，`PluginView.sandbox` 恒 undefined） */
  private sandbox: PluginSandboxLifecycle | null = null;

  constructor(private readonly opts: HostOptions) {
    this.installer = new PluginInstaller(opts.pluginsDir);
    this.registry = new PluginRegistry(opts.pluginsDir, opts.builtinDir);
    this.contributions = new PluginContributionCatalog({
      entries: () => this.entries,
      enabled: (pluginId) => this.enabled(pluginId),
      ready: (entry) => entry.payloadReady && isDirPath(entry.path),
      enginePaths: () => this.enginePaths(),
      shaderPath: (entry, filename) => join(entry.path, 'files', filename),
      fileExists: existsSync,
    });
    this.builtinMaterializer = createBuiltinPluginMaterializer(opts.pluginsDir, this.registry, this.installer, {
      exists: existsSync,
      readFile: readFileSync,
      writeFile: (path, contents) => writeFileSync(path, contents),
    });
    this.state = new JsonStore(opts.statePath);
    this.settings = new JsonStore(opts.settingsPath ?? join(dirname(opts.statePath), 'plugin-settings.json'));
    this.pluginSettings = new PluginSettingsService({
      entries: () => this.entries,
      enabled: (pluginId) => this.enabled(pluginId),
      ready: (entry) => entry.payloadReady && isDirPath(entry.path),
      persistence: this.settings,
    });
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
    try {
      this.setDisabled(this.disabled().filter((x) => x !== id));
    } catch (error) {
      return { ok: false, reason: persistenceFailure(error) };
    }
    const base = join(this.opts.pluginsDir, id);
    for (const suffix of ['.winbox', '.winbox.tmp', '.winbox.bak']) {
      try {
        rmSync(base + suffix, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    await this.refresh();
    return { ok: true, items: await this.list() };
  }

  /** 启停整插件（停用保留磁盘、只不参与宿主装配） */
  async setEnabled(id: string, on: boolean): Promise<PluginOpResult> {
    const cur = this.disabled();
    const next = on ? cur.filter((x) => x !== id) : cur.includes(id) ? cur : [...cur, id];
    try {
      this.setDisabled(next);
    } catch (error) {
      return { ok: false, reason: persistenceFailure(error) };
    }
    await this.ensureLoaded();
    // ★ R10：启停直接影响 L4 沙箱生命周期 → 立刻与登记表对齐（启 → 起沙箱 / 停 → 释放）
    await this.syncSandboxes();
    await this.themeSkins();
    return { ok: true, items: await this.list() };
  }

  /** 超分状态（可选档位 + 实际生效档位） */
  async srState(wanted: unknown): Promise<SrState> {
    await this.ensureLoaded();
    return this.contributions.srState(wanted);
  }

  /** 某档位 → **绝对路径**着色器链（顺序即生效顺序）；未就绪 / `off` → 空数组 */
  async srShaders(mode: unknown): Promise<string[]> {
    await this.ensureLoaded();
    return this.contributions.srShaders(mode);
  }

  /** 当前可用档位（供配置页/播放器显示） */
  async srModes(): Promise<Array<{ id: string; label: string }>> {
    await this.ensureLoaded();
    return this.contributions.srModes();
  }

  /**
   * ★ 插件皮肤（`contributes.theme`）：已启用 + 载荷就位 + 通过内容校验。
   * `id` 已带 `plugin:` 前缀 —— 渲染层**直接拿它作 `data-theme`**。
   * 规范：docs/design/皮肤与主题规范.md（令牌词表 / layout / 校验）。
   */
  async themeSkins(): Promise<ThemeSkinView[]> {
    await this.ensureLoaded();
    const skins = await this.contributions.themeSkins();
    registerPluginSkins(skins);
    return skins;
  }

  /**
   * ★ 插件字幕源（`contributes.subtitle.provider`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 SubtitleProvider。
   * 同 id **先到先得**（内置源 id 已在安装校验期由 `SUBTITLE_ID_TAKEN` 拦掉，不在此重复）。
   * 规范：docs/design/插件制作规范.md §5（L2 声明式 provider）。
   */
  async subtitleProviders(): Promise<SubtitleProvider[]> {
    await this.ensureLoaded();
    return this.contributions.subtitleProviders();
  }

  /**
   * ★ 插件元数据源（`contributes.meta.provider`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 MetaProvider。
   * 同 id **先到先得**（内置 `tmdb`/`douban` id 已在安装校验期由 `META_ID_TAKEN` 拦掉）。
   * 规范：docs/design/插件制作规范.md §5.5。
   */
  async metaProviders(): Promise<MetaProvider[]> {
    await this.ensureLoaded();
    return this.contributions.metaProviders();
  }

  /**
   * ★ 插件发现页数据源（`contributes.discover.source`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 DiscoverSource。
   * 同 id **先到先得**。规范：docs/design/插件制作规范.md §5.6。
   */
  async discoverSources(): Promise<DiscoverSource[]> {
    await this.ensureLoaded();
    return this.contributions.discoverSources();
  }

  /**
   * ★ 插件弹幕源（`contributes.danmaku.source`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 DanmakuSource。
   * 同 id **先到先得**（合成键 `plugin:<contributeId>` 供三步链路路由）。规范：docs/design/插件制作规范.md §5.7。
   */
  async danmakuSources(): Promise<DanmakuSource[]> {
    await this.ensureLoaded();
    return this.contributions.danmakuSources();
  }

  /**
   * ★ 插件直播输出模板（`contributes.live.template`）：已启用 + 载荷就位 + 通过内容校验 → 适配为宿主 LiveTemplate。
   * ★ 本类型**不发请求** —— 只把宿主已解析的直播频道格式化输出；**一个插件可声明多个模板**（各自独立 id），
   *   同 id **先到先得**（含跨插件）。规范：docs/design/插件制作规范.md §5.8。
   */
  async liveTemplates(): Promise<LiveTemplate[]> {
    await this.ensureLoaded();
    return this.contributions.liveTemplates();
  }

  /**
   * ★ 插件受限动作按钮（`contributes.ui.command`）：已启用 + 载荷就位 + 通过内容校验 → 摊平成 `UiCommandView`。
   * ★ 本类型**不取数、不跑代码** —— 主进程只做「校验 + 装配」，动作由**渲染层**按词表执行；同 id **先到先得**。
   * 规范：docs/design/插件制作规范.md §5.9。
   */
  async uiCommands(): Promise<UiCommandView[]> {
    await this.ensureLoaded();
    return this.contributions.uiCommands();
  }

  /**
   * ★ 插件快捷键（`contributes.keymap`）：已启用 + 载荷就位 + 通过内容校验 → 摊平成 `KeymapView`
   * （键位串归一到规范形式，如 `Ctrl+Alt+F`）。★ 本类型**不跑代码、不取数** —— 主进程只做「校验 + 装配」，
   * 动作由**渲染层**按 `ui.command` **同一套词表**执行；同 id **先到先得**。规范：§5.10。
   */
  async keymaps(): Promise<KeymapView[]> {
    await this.ensureLoaded();
    return this.contributions.keymaps();
  }

  /**
   * ★ 插件设置面板（`contributes.settings.panel`）：已启用 + 载荷就位 + 通过内容校验 → 摊平成 `SettingsPanelView`
   * （含**有效值** = 存值合法则用存值、否则回落 `default`）。★ 本类型**不跑代码、不取数** —— 主进程只做
   * 「校验 + 装配 + **代持久化**」，表单渲染与写回由**渲染层**完成；同 id **先到先得**。规范：§5.11。
   * ★ 值的**读取面留给 L4**（`kind:"code"` + `settings` 权限 → `winbox.settings`）；asset 插件自身不读。
   */
  async settingsPanels(): Promise<SettingsPanelView[]> {
    await this.ensureLoaded();
    return this.pluginSettings.panels();
  }


  /**
   * ★ 写一个设置字段值（渲染层表单 onChange → IPC）：值必须过**该字段的类型 / 约束**校验
   * （不合法 → **明确失败**，不静默强转），通过后按 `pluginId → panelId → fieldKey` 分桶持久化。
   * 返回最新的面板列表（渲染层据此收敛）。
   */
  async setPluginSetting(a: { id?: unknown; panelId?: unknown; key?: unknown; value?: unknown }): Promise<PluginSettingResult> {
    await this.ensureLoaded();
    return this.pluginSettings.set(a);
  }


  /**
   * ★ 插件受限 UI 槽位（`contributes.ui.slot`）：已启用 + 载荷就位 + 通过内容校验 → 摊平成 `UiSlotView`。
   * ★ 本类型**不跑代码、不取数** —— 主进程只做「校验 + 装配」，组件树渲染在渲染层
   * （`components/PluginSlot.tsx`，按页面语义名落到对应槽位）；同 id **先到先得**。规范：§5.12。
   */
  async uiSlots(): Promise<UiSlotView[]> {
    await this.ensureLoaded();
    return this.contributions.uiSlots();
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
    return this.contributions.playerEngines();
  }

  /**
   * ★ R11：按 `engine:<contributeId>` 取**启动规格**（已就绪的 exe + **未展开**参数模板 + 协议）。
   * 未启用 / 未就绪 / 未知 / 校验不过 → `null`（由 `engine:start` 明确上屏原因）。
   * ★ 返回的 `exe` 已解析、`args` 仍是模板（占位符展开由 `PlayerEngineController` 按会话上下文完成）。
   */
  async playerEngineSpec(id: string): Promise<EngineLaunchSpec | null> {
    await this.ensureLoaded();
    return this.contributions.playerEngineSpec(id);
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
    factory?: ConstructorParameters<typeof PluginSandboxLifecycle>[0]['factory'];
  }): void {
    this.sandbox = new PluginSandboxLifecycle({
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
    return this.pluginSettings.access();
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
      version: e.manifest.version,
      contentFingerprint: pluginMainFingerprint(join(this.opts.pluginsDir, `${e.id}.winbox`), e.manifest.main),
      permissions: e.manifest.permissions ?? [],
    }));
    await this.sandbox.sync(list);
  }

  // ---- 内部 ----

  /** 物化随包插件：随包 zip → `<pluginsDir>/<id>.winbox/` + `.builtin.json` 侧签 */
  private async materializeBuiltin(): Promise<void> {
    await this.builtinMaterializer.materialize();
  }

  private refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const task = this.performRefresh(generation);
    this.refreshTask = task;
    void task.then(
      () => {
        if (this.refreshTask === task) this.refreshTask = undefined;
      },
      () => {
        if (this.refreshTask === task) this.refreshTask = undefined;
      },
    );
    return task;
  }

  private async performRefresh(generation: number): Promise<void> {
    const entries = await this.registry.list();
    if (generation !== this.refreshGeneration) return;
    this.entries = entries;
    this.loaded = true;
    const skins = await this.contributions.themeSkins();
    if (generation !== this.refreshGeneration) return;
    registerPluginSkins(skins);
    // ★ R10：登记表每次刷新后与 L4 沙箱**幂等对齐**（该跑的在跑、不该跑的释放）
    await this.syncSandboxes();
  }

  private async ensureLoaded(): Promise<void> {
    while (!this.loaded) {
      const active = this.refreshTask;
      if (active) await active;
      else await this.refresh();
    }
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

  private modesOf(entry: PluginEntry): Array<{ id: string; label: string }> {
    return this.contributions.modesOf(entry);
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
    this.state.setObjectStrict('plugins', { disabled: ids });
  }
}

function persistenceFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `保存插件状态失败：${detail}`;
}


function isDirPath(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function pluginMainFingerprint(pluginDir: string, main: string | undefined): string {
  if (!main) return 'missing-entry';
  try {
    return createHash('sha256').update(readFileSync(join(pluginDir, main))).digest('hex');
  } catch {
    return 'unreadable-entry';
  }
}
