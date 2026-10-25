import { ID_RE, type PluginReasonCode, type ValidateResult } from './core';

// ---------- ★ 受限动作按钮契约（`contributes.ui.command`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.9。**L2 声明式**（`kind:"asset"`、`permissions` 恒空、无 `main`）。
//   ★ 插件**不跑代码** —— 按钮只映射到宿主**预定义的动作词表**（`open-url` / `navigate` / `export-live` / `set-theme`），
//     由**渲染层**按受控逻辑执行（既不是主进程取数，也不是引擎行为）。
//   ★ 红线②：**不做任意 React 组件注入** —— 只往宿主既有 UI 表面追加宿主样式的按钮。

/** 命令挂载点（宿主既有 UI 表面） */
export type UiCommandPlacement = 'config' | 'player';
/** 动作词表（宿主预定义；插件只能**选**，不能自己写逻辑） */
export type UiCommandAction = 'open-url' | 'navigate' | 'export-live' | 'set-theme';
/** `navigate` 可去的宿主页面（**语义名**；具体路由由宿主映射，插件不写路径） */
export type UiNavTarget =
  | 'discover' | 'home' | 'history' | 'favorites' | 'live' | 'storage' | 'config' | 'about';

export const UI_COMMAND_PLACEMENTS: readonly UiCommandPlacement[] = ['config', 'player'];
export const UI_COMMAND_ACTIONS: readonly UiCommandAction[] = ['open-url', 'navigate', 'export-live', 'set-theme'];
export const UI_NAV_TARGETS: readonly UiNavTarget[] = [
  'discover', 'home', 'history', 'favorites', 'live', 'storage', 'config', 'about',
];
/** `navigate` 语义名 → 宿主路由（渲染层执行时用） */
export const UI_NAV_PATHS: Record<UiNavTarget, string> = {
  discover: '/', home: '/home', history: '/history', favorites: '/favorites',
  live: '/live', storage: '/storage', config: '/config', about: '/about',
};

/** `contributes` 里 `type:"ui.command"` 的结构（受限动作按钮） */
export interface UiCommandContribute {
  type: 'ui.command';
  /** 稳定 id（同插件内唯一；跨插件同 id 先到先得） */
  id: string;
  /** 按钮文字（短） */
  label: string;
  /** 悬停提示（可选） */
  title?: string;
  /** 挂在哪几个 UI 表面（≥1；每项须在白名单） */
  placement: UiCommandPlacement[];
  /** 动作（决定下面哪些参数必填） */
  action: UiCommandAction;
  /** `action:"open-url"` 必填：仅 `http` / `https` */
  url?: string;
  /** `action:"navigate"` 必填：宿主页面语义名 */
  to?: UiNavTarget;
  /** `action:"navigate"` 且 `to:"config"` 时可选：配置页卡片锚点（`#cfg-<section>`） */
  section?: string;
  /** `action:"export-live"` 可选：模板 id（缺省 = 宿主第一个可用模板） */
  template?: string;
  /** `action:"set-theme"` 必填：皮肤 id（内置 4 套，或 `plugin:<skinId>`） */
  theme?: string;
  /** 执行前二次确认（可选） */
  confirm?: boolean;
}

/** 顶层字段白名单 */
const UI_COMMAND_FIELDS: readonly string[] = [
  'type', 'id', 'label', 'title', 'placement', 'action', 'url', 'to', 'section', 'template', 'theme', 'confirm',
];
/** 各动作的专属字段（其余专属字段**不得出现**） */
const UI_COMMAND_ACTION_FIELDS: Record<UiCommandAction, readonly string[]> = {
  'open-url': ['url'],
  navigate: ['to', 'section'],
  'export-live': ['template'],
  'set-theme': ['theme'],
};
const UI_SECTION_RE = /^[a-z0-9-]{1,40}$/;
const UI_TEMPLATE_RE = /^[a-z0-9][a-z0-9:.-]{2,60}$/;
const UI_THEME_RE = /^(?:plugin:)?[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * ★ 动作参数校验（`ui.command` §5.9 与 `keymap` §5.10 **共用**）——
 *   动作是宿主**预定义能力**，按钮 / 快捷键只是两种触发方式，参数口径必须一致。
 *   `where` = 报错前缀（`ui.command` / `keymap`）；`code` = 两处各自的原因码。
 */
export function actionParamError(
  t: Record<string, unknown>,
  where: string,
  code: { invalid: PluginReasonCode; url: PluginReasonCode },
): ValidateResult {
  const action = t.action as UiCommandAction;
  if (!UI_COMMAND_ACTIONS.includes(action)) {
    return { ok: false, reasonCode: code.invalid, reason: `${where}.action 须为 ${UI_COMMAND_ACTIONS.join(' | ')}` };
  }
  // ★ 各动作只允许自己的专属字段（写错 = 作者以为能做，实际不做 ⇒ 拒装）
  const allowed = UI_COMMAND_ACTION_FIELDS[action];
  for (const k of ['url', 'to', 'section', 'template', 'theme']) {
    if (t[k] != null && !allowed.includes(k)) {
      return { ok: false, reasonCode: code.invalid, reason: `${where}.action=${action} 不接受字段 ${k}` };
    }
  }
  if (t.confirm != null && typeof t.confirm !== 'boolean') {
    return { ok: false, reasonCode: code.invalid, reason: `${where}.confirm（若写）须是布尔` };
  }
  if (action === 'open-url') {
    if (typeof t.url !== 'string' || !/^https?:\/\//i.test(t.url.trim()) || /[\s\r\n]/.test(t.url.trim())) {
      return { ok: false, reasonCode: code.url, reason: `${where}.url 须是 http:// 或 https:// 且不含空白` };
    }
    return { ok: true };
  }
  if (action === 'navigate') {
    if (!UI_NAV_TARGETS.includes(t.to as UiNavTarget)) {
      return { ok: false, reasonCode: code.invalid, reason: `${where}.to 须为 ${UI_NAV_TARGETS.join(' / ')}` };
    }
    if (t.section != null) {
      if (t.to !== 'config') return { ok: false, reasonCode: code.invalid, reason: `${where}.section 只在 to=config 时可用` };
      if (typeof t.section !== 'string' || !UI_SECTION_RE.test(t.section)) {
        return { ok: false, reasonCode: code.invalid, reason: `${where}.section 须匹配 [a-z0-9-]{1,40}` };
      }
    }
    return { ok: true };
  }
  if (action === 'export-live') {
    if (t.template != null && (typeof t.template !== 'string' || !UI_TEMPLATE_RE.test(t.template))) {
      return { ok: false, reasonCode: code.invalid, reason: `${where}.template 须匹配 [a-z0-9][a-z0-9:.-]{2,60}` };
    }
    return { ok: true };
  }
  // set-theme
  if (typeof t.theme !== 'string' || !UI_THEME_RE.test(t.theme)) {
    return { ok: false, reasonCode: code.invalid, reason: `${where}.theme 须是皮肤 id（内置 4 套或 plugin:<skinId>）` };
  }
  return { ok: true };
}

/** 校验 `contributes.ui.command`（纯函数） */
export function validateUiCommandContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command.label 必填（1~40 字，不含换行）' };
  }
  if (t.title != null && (typeof t.title !== 'string' || t.title.length > 120 || /[\r\n]/.test(t.title))) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command.title（若写）须是 ≤120 字且不含换行的字符串' };
  }
  for (const k of Object.keys(t)) {
    if (!UI_COMMAND_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: `ui.command 字段未知：${k}` };
    }
  }
  const pl = t.placement;
  if (!Array.isArray(pl) || !pl.length) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command.placement 须是非空数组' };
  }
  const seen = new Set<string>();
  for (const p of pl) {
    if (!UI_COMMAND_PLACEMENTS.includes(p as UiCommandPlacement)) {
      return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: `ui.command.placement 取值非法：${p}（允许 ${UI_COMMAND_PLACEMENTS.join(' / ')}）` };
    }
    if (seen.has(p as string)) return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: `ui.command.placement 重复：${p}` };
    seen.add(p as string);
  }
  const ar = actionParamError(t, 'ui.command', { invalid: 'UI_COMMAND_INVALID', url: 'BAD_UI_COMMAND_URL' });
  if (!ar.ok) return ar;
  return { ok: true };
}

// ---------- ★ 追加快捷键契约（`contributes.keymap`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.10。**L3 声明式**（`kind:"asset"`、`permissions` 恒空、无 `main`）。
//   ★ 与 `ui.command` 用**同一套动作词表** —— 键盘只是另一种**触发方式**（按钮 / 快捷键），
//     动作的实际执行由渲染层 `features/plugins/application/pluginCommand.ts` 通过宿主端口完成（主进程只校验 + 装配）。
//   ★ 「不与宿主冲突」的硬护栏：键位**必须含 Ctrl / Alt / Meta 至少一个**（Shift 单独不算）；
//     主键**仅允许 A~Z / 0~9 / F1~F24** —— 不含方向键 / Backspace / Esc 等宿主已占用的键。
//   ★ 红线②：不注入任何插件自带 UI，只在宿主既有表面（配置页「快捷键」一览 + 播放器键位面板）展示。

/** 快捷键作用域：`app` = 主窗口（App.tsx 全局）/ `player` = 播放器窗口（VideoPlayer） */
export type KeymapScope = 'app' | 'player';
export const KEYMAP_SCOPES: readonly KeymapScope[] = ['app', 'player'];
/** 动作 = **复用** `ui.command` 词表（动作是宿主能力，与触发方式无关） */
export type KeymapAction = UiCommandAction;

/** 修饰键（规范化顺序：Ctrl → Alt → Shift → Meta） */
export type KeymapModifier = 'Ctrl' | 'Alt' | 'Shift' | 'Meta';
export const KEYMAP_MODIFIERS: readonly KeymapModifier[] = ['Ctrl', 'Alt', 'Shift', 'Meta'];
/** 修饰键别名（大小写不敏感；便于作者书写） */
const KEYMAP_MOD_ALIAS: Record<string, KeymapModifier> = {
  ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta', super: 'Meta', win: 'Meta',
};
/** 主键白名单：单个字母 / 数字 / F1~F24（**不含**方向键、Backspace、Esc 等宿主已占用键） */
const KEYMAP_MAIN_RE = /^(?:[A-Za-z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/;

export interface ParsedKeyCombo { mods: KeymapModifier[]; main: string; canonical: string }

/** 解析键位串（大小写不敏感 / 修饰键顺序不限 / 别名归一）；返回规范化结果或错误描述 */
export function parseKeyCombo(key: unknown): { ok: true; combo: ParsedKeyCombo } | { ok: false; error: string } {
  if (typeof key !== 'string' || !key.trim()) return { ok: false, error: '键位必填（如 Ctrl+Alt+F）' };
  const parts = key.split('+').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { ok: false, error: '键位须是「修饰键 + 主键」，如 Ctrl+Alt+F' };
  const main = parts[parts.length - 1];
  const mods: KeymapModifier[] = [];
  for (const tok of parts.slice(0, -1)) {
    const m = KEYMAP_MOD_ALIAS[tok.toLowerCase()];
    if (!m) return { ok: false, error: `未知修饰键：${tok}（允许 Ctrl / Alt / Shift / Meta）` };
    if (mods.includes(m)) return { ok: false, error: `修饰键重复：${m}` };
    mods.push(m);
  }
  if (!(mods.includes('Ctrl') || mods.includes('Alt') || mods.includes('Meta'))) {
    return { ok: false, error: '必须含 Ctrl / Alt / Meta 至少一个（Shift 单独不算，避免劫持普通按键）' };
  }
  if (!KEYMAP_MAIN_RE.test(main)) {
    return { ok: false, error: `主键非法：${main}（仅允许 A~Z / 0~9 / F1~F24；不含方向键等宿主已占用键）` };
  }
  const orderedMods = KEYMAP_MODIFIERS.filter((m) => mods.includes(m));
  const canonical = [...orderedMods, main.toUpperCase()].join('+');
  return { ok: true, combo: { mods: orderedMods, main: main.toUpperCase(), canonical } };
}

/** `contributes` 里 `type:"keymap"` 的结构（追加快捷键；动作复用 `ui.command` 词表） */
export interface KeymapContribute {
  type: 'keymap';
  /** 稳定 id（同插件内唯一；跨插件同 id 先到先得） */
  id: string;
  /** 中文说明（配置页只读一览 / 播放器键位面板显示） */
  label: string;
  /** 悬停提示（可选） */
  title?: string;
  /** 生效范围（≥1；每项须在白名单） */
  scope: KeymapScope[];
  /** 键位串，如 `Ctrl+Alt+F`（**必须含 Ctrl / Alt / Meta**） */
  key: string;
  /** 动作（复用 `ui.command` 词表；决定下面哪些参数必填） */
  action: KeymapAction;
  url?: string;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** 顶层字段白名单 */
const KEYMAP_FIELDS: readonly string[] = [
  'type', 'id', 'label', 'title', 'scope', 'key', 'action', 'url', 'to', 'section', 'template', 'theme', 'confirm',
];

/** 校验 `contributes.keymap`（纯函数） */
export function validateKeymapContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap.label 必填（1~40 字，不含换行）' };
  }
  if (t.title != null && (typeof t.title !== 'string' || t.title.length > 120 || /[\r\n]/.test(t.title))) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap.title（若写）须是 ≤120 字且不含换行的字符串' };
  }
  for (const k of Object.keys(t)) {
    if (!KEYMAP_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: `keymap 字段未知：${k}` };
    }
  }
  const sc = t.scope;
  if (!Array.isArray(sc) || !sc.length) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap.scope 须是非空数组' };
  }
  const seen = new Set<string>();
  for (const s of sc) {
    if (!KEYMAP_SCOPES.includes(s as KeymapScope)) {
      return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: `keymap.scope 取值非法：${s}（允许 ${KEYMAP_SCOPES.join(' / ')}）` };
    }
    if (seen.has(s as string)) return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: `keymap.scope 重复：${s}` };
    seen.add(s as string);
  }
  const kp = parseKeyCombo(t.key);
  if (!kp.ok) return { ok: false, reasonCode: 'BAD_KEYMAP_KEY', reason: `keymap.key：${kp.error}` };
  const ar = actionParamError(t, 'keymap', { invalid: 'KEYMAP_INVALID', url: 'BAD_KEYMAP_URL' });
  if (!ar.ok) return ar;
  return { ok: true };
}

/** 取插件的**第一个** `keymap` 贡献项（未声明 → undefined；一个插件可声明多条，宿主按全部装配） */
export function keymapContributeOf(contributes: Array<{ type: string }> | undefined): KeymapContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'keymap');
  return c ? (c as unknown as KeymapContribute) : undefined;
}
