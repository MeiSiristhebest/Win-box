import { ID_RE, type ValidateResult } from './core';

// ---------- ★ 插件设置面板契约（`contributes.settings.panel`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.11。**L3 声明式 UI**（`kind:"asset"`、`permissions` 恒空、无 `main`）。
//   ★ 插件**不跑代码** —— 只声明「一组受限字段」（label / type / default），宿主把它渲染成**宿主样式的表单**，
//     并**代插件持久化**字段值（按插件 id 分桶存 `<userData>/plugin-settings.json`）；**读取面留给 L4**
//     （`kind:"code"` 的沙箱代码经 `settings` 权限读 `winbox.settings`）—— 与 R1~R7「asset 先实装、code 形待 L4」同口径。
//   ★ 红线②：不做任意 React 组件注入 —— 仅 4 类**受限字段**，不含任意 HTML / 富文本 / 自定义组件。

/** 受限字段词表（4 类；**插件只能选**，不能自己写控件） */
export type SettingsFieldType = 'toggle' | 'select' | 'text' | 'number';
export const SETTINGS_FIELD_TYPES: readonly SettingsFieldType[] = ['toggle', 'select', 'text', 'number'];
/** 字段值（与 `type` 一一对应：toggle→boolean / select·text→string / number→number） */
export type SettingsValue = boolean | string | number;

/** `select` 的一个选项 */
export interface SettingsOption { value: string; label?: string }

/** 单个受限字段 */
export interface SettingsFieldContribute {
  /** 稳定 key（同面板内唯一；`[a-z0-9-]{1,40}`）—— L4 读取时按它取值 */
  key: string;
  /** 中文标签（1~40 字，不含换行） */
  label: string;
  /** 字段类型（词表；决定参数与值类型） */
  type: SettingsFieldType;
  /** 默认值（**必须与 type 匹配**） */
  default: SettingsValue;
  /** `select` 必填：1~50 个选项（`value` 唯一） */
  options?: SettingsOption[];
  /** `text` 可选：最大长度 1~200 */
  maxLength?: number;
  /** `text` 可选：占位符（≤60 字，不含换行） */
  placeholder?: string;
  /** `number` 可选：下限 */
  min?: number;
  /** `number` 可选：上限 */
  max?: number;
  /** `number` 可选：步长（正数） */
  step?: number;
  /** 可选：说明 / 悬停提示（≤120 字，不含换行） */
  hint?: string;
}

/** `contributes` 里 `type:"settings.panel"` 的结构（插件设置面板） */
export interface SettingsPanelContribute {
  type: 'settings.panel';
  /** 稳定 id（同插件内唯一；跨插件同 id 先到先得） */
  id: string;
  /** 面板标题（1~40 字，不含换行） */
  label: string;
  /** 可选：悬停提示（≤120 字） */
  title?: string;
  /** 字段（≥1、≤24；`key` 不得重复） */
  fields: SettingsFieldContribute[];
}

/** key 规则：1~40，且不以 `-` 开头/结尾 */
const SETTINGS_KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SETTINGS_PANEL_FIELDS: readonly string[] = ['type', 'id', 'label', 'title', 'fields'];
const SETTINGS_FIELD_FIELDS: readonly string[] = [
  'key', 'label', 'type', 'default', 'options', 'maxLength', 'placeholder', 'min', 'max', 'step', 'hint',
];
const SETTINGS_MAX_FIELDS = 24;
const SETTINGS_MAX_OPTIONS = 50;
/** 各类型**只**允许自己的专属参数（写别的类型才认的参数 ⇒ 拒装，同 §5.9/§5.10 口径） */
const SETTINGS_TYPE_FIELDS: Record<SettingsFieldType, readonly string[]> = {
  toggle: [], select: ['options'], text: ['maxLength', 'placeholder'], number: ['min', 'max', 'step'],
};

/**
 * 字段**值**是否满足该字段的类型 / 约束（`set` 校验 与「有效值回落」**共用同一实现**）。
 * 返回错误描述；undefined = 合法。
 */
export function settingsValueError(
  f: Pick<SettingsFieldContribute, 'type' | 'options' | 'maxLength' | 'min' | 'max'>,
  value: unknown,
): string | undefined {
  if (f.type === 'toggle') return typeof value === 'boolean' ? undefined : '须是布尔';
  if (f.type === 'select') {
    if (typeof value !== 'string') return '须是字符串';
    return (f.options ?? []).some((o) => o.value === value) ? undefined : '须是 options 里的某个 value';
  }
  if (f.type === 'text') {
    if (typeof value !== 'string') return '须是字符串';
    if (/[\r\n]/.test(value)) return '不得含换行';
    if (f.maxLength != null && value.length > f.maxLength) return `超过最大长度 ${f.maxLength}`;
    return undefined;
  }
  // number
  if (typeof value !== 'number' || !Number.isFinite(value)) return '须是有限数字';
  if (f.min != null && value < f.min) return `低于下限 ${f.min}`;
  if (f.max != null && value > f.max) return `高于上限 ${f.max}`;
  return undefined;
}

/** 有效值 = 存过且合法 → 用存值；否则回落字段默认值（防记忆损坏 / 旧版本残留） */
export function settingsEffectiveValue(f: SettingsFieldContribute, stored: unknown): SettingsValue {
  return stored != null && settingsValueError(f, stored) === undefined ? (stored as SettingsValue) : f.default;
}

/** 单字段校验 */
function settingsFieldError(f: unknown, i: number): ValidateResult {
  const where = `settings.panel.fields[${i}]`;
  if (!f || typeof f !== 'object' || Array.isArray(f)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where} 非法` };
  }
  const t = f as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (!SETTINGS_FIELD_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where} 字段未知：${k}` };
    }
  }
  if (typeof t.key !== 'string' || !SETTINGS_KEY_RE.test(t.key)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.key 须匹配 [a-z0-9-]{1,40}` };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.label 必填（1~40 字，不含换行）` };
  }
  if (t.hint != null && (typeof t.hint !== 'string' || t.hint.length > 120 || /[\r\n]/.test(t.hint))) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.hint（若写）须是 ≤120 字且不含换行的字符串` };
  }
  const type = t.type as SettingsFieldType;
  if (!SETTINGS_FIELD_TYPES.includes(type)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.type 须为 ${SETTINGS_FIELD_TYPES.join(' | ')}` };
  }
  const allowed = SETTINGS_TYPE_FIELDS[type];
  for (const k of ['options', 'maxLength', 'placeholder', 'min', 'max', 'step']) {
    if (t[k] != null && !allowed.includes(k)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.type=${type} 不接受字段 ${k}` };
    }
  }
  if (type === 'toggle') {
    if (typeof t.default !== 'boolean') {
      return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 须是布尔（toggle）` };
    }
    return { ok: true };
  }
  if (type === 'select') {
    const opts = t.options;
    if (!Array.isArray(opts) || !opts.length || opts.length > SETTINGS_MAX_OPTIONS) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options 须是 1~${SETTINGS_MAX_OPTIONS} 项数组（select）` };
    }
    const seen = new Set<string>();
    for (const o of opts) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options 项非法` };
      }
      const ot = o as Record<string, unknown>;
      for (const k of Object.keys(ot)) {
        if (k !== 'value' && k !== 'label') {
          return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options 项字段未知：${k}` };
        }
      }
      if (typeof ot.value !== 'string' || !ot.value.trim() || ot.value.length > 60) {
        return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options[].value 必填（1~60 字）` };
      }
      if (seen.has(ot.value)) {
        return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options[].value 重复：${ot.value}` };
      }
      seen.add(ot.value);
      if (ot.label != null && (typeof ot.label !== 'string' || !ot.label.trim() || ot.label.length > 40)) {
        return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options[].label（若写）须是 1~40 字` };
      }
    }
    if (typeof t.default !== 'string' || !seen.has(t.default)) {
      return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 须是 options 里的某个 value（select）` };
    }
    return { ok: true };
  }
  if (type === 'text') {
    if (t.maxLength != null && (typeof t.maxLength !== 'number' || !Number.isInteger(t.maxLength) || t.maxLength < 1 || t.maxLength > 200)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.maxLength 须是 1~200 整数` };
    }
    if (t.placeholder != null && (typeof t.placeholder !== 'string' || t.placeholder.length > 60 || /[\r\n]/.test(t.placeholder))) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.placeholder（若写）须是 ≤60 字且不含换行的字符串` };
    }
    if (
      typeof t.default !== 'string' || /[\r\n]/.test(t.default) ||
      (t.maxLength != null && t.default.length > (t.maxLength as number))
    ) {
      return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 须是字符串且不超过 maxLength（text）` };
    }
    return { ok: true };
  }
  // number
  const min = t.min, max = t.max, step = t.step;
  for (const [k, v] of [['min', min], ['max', max], ['step', step]] as const) {
    if (v != null && (typeof v !== 'number' || !Number.isFinite(v))) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.${k}（若写）须是有限数字` };
    }
  }
  if (min != null && max != null && (min as number) > (max as number)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.min 不得大于 max` };
  }
  if (step != null && (step as number) <= 0) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.step（若写）须是正数` };
  }
  const dflt = t.default;
  if (typeof dflt !== 'number' || !Number.isFinite(dflt)) {
    return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 须是有限数字（number）` };
  }
  if ((min != null && dflt < (min as number)) || (max != null && dflt > (max as number))) {
    return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 超出 [min, max]（number）` };
  }
  return { ok: true };
}

/** 校验 `contributes.settings.panel`（纯函数） */
export function validateSettingsPanelContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: 'settings.panel 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: 'settings.panel.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: 'settings.panel.label 必填（1~40 字，不含换行）' };
  }
  if (t.title != null && (typeof t.title !== 'string' || t.title.length > 120 || /[\r\n]/.test(t.title))) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: 'settings.panel.title（若写）须是 ≤120 字且不含换行的字符串' };
  }
  for (const k of Object.keys(t)) {
    if (!SETTINGS_PANEL_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `settings.panel 字段未知：${k}` };
    }
  }
  const fs = t.fields;
  if (!Array.isArray(fs) || !fs.length || fs.length > SETTINGS_MAX_FIELDS) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `settings.panel.fields 须是 1~${SETTINGS_MAX_FIELDS} 项数组` };
  }
  const seen = new Set<string>();
  for (let i = 0; i < fs.length; i++) {
    const r = settingsFieldError(fs[i], i);
    if (!r.ok) return r;
    const key = (fs[i] as Record<string, unknown>).key as string;
    if (seen.has(key)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `settings.panel.fields key 重复：${key}` };
    }
    seen.add(key);
  }
  return { ok: true };
}

/** 取插件的**第一个** `settings.panel` 贡献项（未声明 → undefined；一个插件可声明多个面板，宿主按全部装配） */
export function settingsPanelContributeOf(contributes: Array<{ type: string }> | undefined): SettingsPanelContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'settings.panel');
  return c ? (c as unknown as SettingsPanelContribute) : undefined;
}
