import type { Contribute, PluginKind, PluginLevel } from './manifest';
import type { ThemeContribute, ThemeLayout } from './theme';
import type { SubtitleProviderContribute } from './subtitleProvider';
import type { MetaProviderContribute } from './metaProvider';
import type { DiscoverSourceContribute } from './discoverSource';
import type { DanmakuSourceContribute } from './danmakuSource';
import type { LiveTemplateContribute } from './liveTemplate';
import type { UiCommandAction, UiCommandContribute, UiCommandPlacement, UiNavTarget, KeymapAction, KeymapScope } from './uiActions';
import type { SettingsFieldType, SettingsOption, SettingsValue } from './settingsPanel';
import type { UiSlotId, UiSlotItemType, UiSlotKvItem } from './uiSlot';
import type { PlayerEngineBinarySource, PlayerEngineCapability } from './playerEngine';

/** 取插件的 `theme` 贡献项（未声明 → undefined） */
export function themeContributeOf(contributes: Contribute[] | undefined): ThemeContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'theme');
  return c ? (c as unknown as ThemeContribute) : undefined;
}

/** 取插件的 `subtitle.provider` 贡献项（未声明 → undefined） */
export function subtitleProviderContributeOf(contributes: Contribute[] | undefined): SubtitleProviderContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'subtitle.provider');
  return c ? (c as unknown as SubtitleProviderContribute) : undefined;
}

/** 取插件的 `meta.provider` 贡献项（未声明 → undefined） */
export function metaProviderContributeOf(contributes: Contribute[] | undefined): MetaProviderContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'meta.provider');
  return c ? (c as unknown as MetaProviderContribute) : undefined;
}

/** 取插件的 `discover.source` 贡献项（未声明 → undefined） */
export function discoverSourceContributeOf(contributes: Contribute[] | undefined): DiscoverSourceContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'discover.source');
  return c ? (c as unknown as DiscoverSourceContribute) : undefined;
}

/** 取插件的 `danmaku.source` 贡献项（未声明 → undefined） */
export function danmakuSourceContributeOf(contributes: Contribute[] | undefined): DanmakuSourceContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'danmaku.source');
  return c ? (c as unknown as DanmakuSourceContribute) : undefined;
}

/** 取插件的 `live.template` 贡献项（未声明 → undefined） */
export function liveTemplateContributeOf(contributes: Contribute[] | undefined): LiveTemplateContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'live.template');
  return c ? (c as unknown as LiveTemplateContribute) : undefined;
}

/** 取插件的**第一个** `ui.command` 贡献项（未声明 → undefined；一个插件可声明多个，宿主按全部装配） */
export function uiCommandContributeOf(contributes: Contribute[] | undefined): UiCommandContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'ui.command');
  return c ? (c as unknown as UiCommandContribute) : undefined;
}

// ---------- ★ 渲染层/管理器可见的**视图模型**（主进程组装，preload 与 client 共用类型） ----------

/** 插件沙箱（`kind:"code"`）运行态；asset 插件恒 undefined（★ R10） */
export interface PluginSandboxView {
  /** 沙箱 worker 是否存活 */
  running: boolean;
  /** 最近一次启动失败原因（成功 / 未启动 → undefined） */
  error?: string;
}

/** ★ R10：安装前**干跑**（`plugin:inspect`）结果 —— 供渲染层弹「权限确认」 */
export interface PluginInspectResult {
  ok: boolean;
  /** 用户取消了文件选择（不装） */
  canceled?: boolean;
  reason?: string;
  reasonCode?: string;
  /** 选中的文件路径（确认后原样回传给 `plugin:install`） */
  path?: string;
  id?: string;
  name?: string;
  version?: string;
  kind?: PluginKind;
  permissions?: string[];
  permissionNotes?: Record<string, string>;
}

/** 插件条目视图（管理器列表 / 播放器超分入口用） */
export interface PluginView {
  id: string;
  name: string;
  version: string;
  source: 'builtin' | 'user';
  level: PluginLevel;
  /** ★ R10：能力形态（code 插件在沙箱里跑，配置页据此显示权限徽标） */
  kind: PluginKind;
  /** ★ R10：已声明权限（`kind:"code"` 非空；asset 恒空） */
  permissions: string[];
  /** ★ R10：`kind:"code"` 的沙箱运行态（asset 插件 → undefined） */
  sandbox?: PluginSandboxView;
  /** 是否启用（停用保留磁盘，只不参与宿主装配） */
  enabled: boolean;
  /** 载荷是否已就位（可访问的目录） */
  ready: boolean;
  /** 可用档位（仅 `mpv.shaders` 插件非空） */
  modes: Array<{ id: string; label: string }>;
}

/** 插件皮肤视图（主进程组装 → 渲染层皮肤注册表消费） */
export interface ThemeSkinView {
  /** 生效值：**直接作为 `data-theme` 使用**（形如 `plugin:<skinId>`） */
  id: string;
  /** 来源插件 id */
  pluginId: string;
  label: string;
  base: 'dark' | 'light';
  tokens: Record<string, string>;
  layout: ThemeLayout;
}

/** 超分状态（播放器按钮据此显示与高亮） */
export interface SrState {
  /** 是否有可用超分插件（未装/未就位 → false，按钮不显示） */
  available: boolean;
  modes: Array<{ id: string; label: string }>;
  /** 实际生效档位（未就绪一律 `off`；见 shared/player.srModeUsable） */
  mode: string;
}

/** 直播输出模板视图（导出面板消费；内置默认模板 `pluginId='builtin'`） */
export interface LiveTemplateView {
  id: string;
  pluginId: string;
  label: string;
  format: 'txt' | 'm3u';
  ext: string;
}

/** 受限动作按钮视图（配置页 / 播放器控制条消费；执行由渲染层按动作词表完成） */
export interface UiCommandView {
  id: string;
  pluginId: string;
  /** 来源插件显示名（按钮 tooltip / 来源标注用） */
  pluginName: string;
  label: string;
  title?: string;
  placement: UiCommandPlacement[];
  action: UiCommandAction;
  url?: string;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** 插件快捷键视图（配置页「快捷键」只读一览 / 播放器键位面板消费；动作由渲染层按词表执行） */
export interface KeymapView {
  id: string;
  pluginId: string;
  pluginName: string;
  label: string;
  title?: string;
  scope: KeymapScope[];
  /** **规范化**键位串（如 `Ctrl+Alt+F`）—— 渲染层据此匹配键盘事件 */
  key: string;
  action: KeymapAction;
  url?: string;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** 设置面板单字段视图（含**有效值** = 存值合法则用存值，否则回落 default） */
export interface SettingsFieldView {
  key: string;
  label: string;
  type: SettingsFieldType;
  value: SettingsValue;
  options?: SettingsOption[];
  maxLength?: number;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

/** 插件设置面板视图（配置页「插件」卡片内消费；渲染层负责表单渲染 + 写回宿主持久化） */
export interface SettingsPanelView {
  id: string;
  pluginId: string;
  pluginName: string;
  label: string;
  title?: string;
  fields: SettingsFieldView[];
}

/** 受限组件视图（与贡献项同形；★ 只搬运白名单字段） */
export interface UiSlotItemView {
  type: UiSlotItemType;
  text?: string;
  url?: string;
  alt?: string;
  items?: UiSlotKvItem[];
  label?: string;
  action?: UiCommandAction;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** 受限 UI 槽位视图（渲染层 `<PluginSlot slot="…" />` 消费；link 由渲染层按动作词表执行） */
export interface UiSlotView {
  id: string;
  pluginId: string;
  pluginName: string;
  slot: UiSlotId[];
  label?: string;
  title?: string;
  items: UiSlotItemView[];
}

/**
 * ★ 第三方播放内核视图（渲染层内核列表消费；见 §6.3）。
 * `id` = **渲染层内核值** `engine:<contributeId>` —— 与 `Kernel` / `KernelPref` 的扩展口径一致。
 */
export interface PlayerEngineView {
  /** 渲染层内核值：`engine:<contributeId>` */
  id: string;
  pluginId: string;
  pluginName: string;
  label: string;
  capabilities: PlayerEngineCapability[];
  /** 二进制来源（内置 2 无此项；`local-path` 的引擎在配置页才显示「本机程序路径」输入框） */
  source?: PlayerEngineBinarySource;
  /** 是否已就绪（exe 解析成功）；未就绪 → 列表里显示不可选 + 原因 */
  ready: boolean;
  /** 就绪时的 exe 绝对路径（渲染层不碰文件系统，仅用于展示/排障） */
  path?: string;
  /** 未就绪原因（人话） */
  note?: string;
}
