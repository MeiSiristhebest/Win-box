import { ID_RE, type ValidateResult } from './core';
import { actionParamError, type UiCommandAction, type UiNavTarget } from './uiActions';

// ---------- ★ 受限 UI 槽位契约（`contributes.ui.slot`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.12。**L3 声明式 UI**（`kind:"asset"`、`permissions` 恒空、无 `main`）。
//   ★ 插件**不跑代码、不注入任何 UI**（红线②：不做任意 React 组件注入）—— 只声明一棵**受限组件树**
//     （6 类组件），宿主把它渲染进**宿主既有页面的槽位**里（自己的样式、自己的交互）。
//   ★ `link` 组件**复用 §5.9 的动作词表**（与 `ui.command`/`keymap` 同一套），由渲染层同一执行器执行。

/** 宿主开放的槽位（页面语义名；渲染层据此把内容追加到对应页面） */
export type UiSlotId = 'discover' | 'home' | 'detail' | 'live' | 'history' | 'favorites';
export const UI_SLOT_IDS: readonly UiSlotId[] = ['discover', 'home', 'detail', 'live', 'history', 'favorites'];

/** 受限组件词表（6 类；**插件只能选**，不能自己写控件 / 注入 HTML） */
export type UiSlotItemType = 'heading' | 'text' | 'image' | 'divider' | 'kv' | 'link';
export const UI_SLOT_ITEM_TYPES: readonly UiSlotItemType[] = ['heading', 'text', 'image', 'divider', 'kv', 'link'];

/** `kv` 组件的一行 */
export interface UiSlotKvItem { label: string; value: string }

/** 受限组件（各类型只允许自己的字段 —— 写了别的类型才认的字段 ⇒ 拒装，同 §5.9~§5.11 口径） */
export interface UiSlotItem {
  type: UiSlotItemType;
  /** `heading`（1~80 字，不含换行）/ `text`（1~500 字，可含换行）必填 */
  text?: string;
  /** `image` 必填（仅 http/https）/ `link` 的 `open-url` 参数（同名同义，按 `type` 区分） */
  url?: string;
  /** `image` 可选：替代文本（≤80 字，不含换行） */
  alt?: string;
  /** `kv` 必填：1~12 行 */
  items?: UiSlotKvItem[];
  /** `link` 必填：按钮文字（1~40 字，不含换行） */
  label?: string;
  /** `link` 必填：动作（复用 §5.9 词表） */
  action?: UiCommandAction;
  /** `link` 的动作参数（与 `action` 匹配，规则同 §5.9） */
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** `contributes` 里 `type:"ui.slot"` 的结构（受限 UI 槽位） */
export interface UiSlotContribute {
  type: 'ui.slot';
  /** 稳定 id（同插件内唯一；跨插件同 id 先到先得） */
  id: string;
  /** 目标槽位（≥1；每项须在白名单） */
  slot: UiSlotId[];
  /** 可选：内容区小标题（1~40 字，不含换行） */
  label?: string;
  /** 可选：悬停提示（≤120 字） */
  title?: string;
  /** 组件树（≥1、≤24） */
  items: UiSlotItem[];
}

const UI_SLOT_FIELDS: readonly string[] = ['type', 'id', 'slot', 'label', 'title', 'items'];
const UI_SLOT_ITEM_FIELDS: readonly string[] = [
  'type', 'text', 'url', 'alt', 'items', 'label', 'action', 'to', 'section', 'template', 'theme', 'confirm',
];
/** 各组件类型**只**允许自己的字段 */
const UI_SLOT_ITEM_TYPE_FIELDS: Record<UiSlotItemType, readonly string[]> = {
  heading: ['text'], text: ['text'], divider: [],
  image: ['url', 'alt'], kv: ['items'],
  link: ['label', 'action', 'url', 'to', 'section', 'template', 'theme', 'confirm'],
};
const UI_SLOT_MAX_ITEMS = 24;
const UI_SLOT_MAX_KV = 12;
/** http/https 且不含空白 */
function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v) && !/[\s\r\n]/.test(v);
}
const UI_SLOT_TEXT_MAX = 500;

/** 单组件校验 */
function uiSlotItemError(it: unknown, i: number): ValidateResult {
  const where = `ui.slot.items[${i}]`;
  if (!it || typeof it !== 'object' || Array.isArray(it)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where} 非法` };
  }
  const t = it as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (!UI_SLOT_ITEM_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where} 字段未知：${k}` };
    }
  }
  const type = t.type as UiSlotItemType;
  if (!UI_SLOT_ITEM_TYPES.includes(type)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.type 须为 ${UI_SLOT_ITEM_TYPES.join(' | ')}` };
  }
  const allowed = UI_SLOT_ITEM_TYPE_FIELDS[type];
  for (const k of UI_SLOT_ITEM_FIELDS) {
    if (k === 'type' || t[k] == null) continue;
    if (!allowed.includes(k)) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.type=${type} 不接受字段 ${k}` };
    }
  }
  if (type === 'heading' || type === 'text') {
    const max = type === 'heading' ? 80 : UI_SLOT_TEXT_MAX;
    if (typeof t.text !== 'string' || !t.text.trim() || t.text.length > max || (type === 'heading' && /[\r\n]/.test(t.text))) {
      return {
        ok: false, reasonCode: 'UI_SLOT_INVALID',
        reason: `${where}.text 必填（1~${max} 字${type === 'heading' ? '，不含换行' : ''}）`,
      };
    }
    return { ok: true };
  }
  if (type === 'divider') return { ok: true };
  if (type === 'image') {
    if (typeof t.url !== 'string' || !isHttpUrl(t.url)) {
      return { ok: false, reasonCode: 'BAD_UI_SLOT_URL', reason: `${where}.url 须是 http:// 或 https:// 且不含空白` };
    }
    if (t.alt != null && (typeof t.alt !== 'string' || t.alt.length > 80 || /[\r\n]/.test(t.alt))) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.alt（若写）须是 ≤80 字且不含换行的字符串` };
    }
    return { ok: true };
  }
  if (type === 'kv') {
    const items = t.items;
    if (!Array.isArray(items) || !items.length || items.length > UI_SLOT_MAX_KV) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items 须是 1~${UI_SLOT_MAX_KV} 行数组（kv）` };
    }
    for (const row of items) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items 行非法` };
      }
      const r = row as Record<string, unknown>;
      for (const k of Object.keys(r)) {
        if (k !== 'label' && k !== 'value') {
          return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items 行字段未知：${k}` };
        }
      }
      if (typeof r.label !== 'string' || !r.label.trim() || r.label.length > 40 || /[\r\n]/.test(r.label)) {
        return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items[].label 必填（1~40 字，不含换行）` };
      }
      if (typeof r.value !== 'string' || !r.value.trim() || r.value.length > 200 || /[\r\n]/.test(r.value)) {
        return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items[].value 必填（1~200 字，不含换行）` };
      }
    }
    return { ok: true };
  }
  // link：label 必填 + 动作参数（★ **复用** §5.9 的共用校验，口径只有一处）
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.label 必填（1~40 字，不含换行，link）` };
  }
  return actionParamError(t, 'ui.slot.link', { invalid: 'UI_SLOT_INVALID', url: 'BAD_UI_SLOT_URL' });
}

/** 校验 `contributes.ui.slot`（纯函数） */
export function validateUiSlotContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (t.label != null && (typeof t.label !== 'string' || !t.label.trim() || t.label.length > 40 || /[\r\n]/.test(t.label))) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot.label（若写）须是 1~40 字且不含换行' };
  }
  if (t.title != null && (typeof t.title !== 'string' || t.title.length > 120 || /[\r\n]/.test(t.title))) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot.title（若写）须是 ≤120 字且不含换行的字符串' };
  }
  for (const k of Object.keys(t)) {
    if (!UI_SLOT_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `ui.slot 字段未知：${k}` };
    }
  }
  const slots = t.slot;
  if (!Array.isArray(slots) || !slots.length) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot.slot 须是非空数组' };
  }
  const seen = new Set<string>();
  for (const s of slots) {
    if (!UI_SLOT_IDS.includes(s as UiSlotId)) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `ui.slot.slot 取值非法：${s}（允许 ${UI_SLOT_IDS.join(' / ')}）` };
    }
    if (seen.has(s as string)) return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `ui.slot.slot 重复：${s}` };
    seen.add(s as string);
  }
  const items = t.items;
  if (!Array.isArray(items) || !items.length || items.length > UI_SLOT_MAX_ITEMS) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `ui.slot.items 须是 1~${UI_SLOT_MAX_ITEMS} 项数组` };
  }
  for (let i = 0; i < items.length; i++) {
    const r = uiSlotItemError(items[i], i);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** 取插件的**第一个** `ui.slot` 贡献项（未声明 → undefined；一个插件可声明多个槽位，宿主按全部装配） */
export function uiSlotContributeOf(contributes: Array<{ type: string }> | undefined): UiSlotContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'ui.slot');
  return c ? (c as unknown as UiSlotContribute) : undefined;
}
