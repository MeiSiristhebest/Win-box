import { ID_RE, type ValidateResult } from './core';
import {
  PLACEHOLDER_RE,
  isProviderPath,
  placeholdersOf,
  providerHeadersError,
  providerUrlError,
} from './providerSchema';
import type { ProviderHttpSpec } from './providerSchema';

// ---------- ★ 字幕源契约（`contributes.subtitle.provider`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5（L2 声明式 provider）。
// ★ L2 = **纯声明式**：宿主按插件的「受限 URL 模板 + JSON 路径映射」**代发请求并取数**，
//   **不执行插件的代码** → `kind:"asset"` 且 `permissions` 恒空。
// ★ v1 仅 GET（无 POST / 无鉴权）：需要 POST / 需要 token / 需要自己算 → 用 `kind:"code"`（L4）。

/** 受限请求描述（地址模板 + 额外请求头） */
export interface SubHttpSpec extends ProviderHttpSpec {}

/** `contributes` 里 `type:"subtitle.provider"` 的结构（L2 声明式字幕源） */
export interface SubtitleProviderContribute {
  type: 'subtitle.provider';
  /** 稳定 id（写入候选的 `provider` 字段；不得占用内置源 / 别插件已用的 id） */
  id: string;
  name: string;
  search: SubHttpSpec & {
    /** 响应里**数组**所在的点号路径（如 `data.list`；空串不可） */
    list: string;
    /** 候选项字段映射：源 JSON 字段 → 候选字段 */
    map: { file: string; subname: string; title?: string; lang?: string; format?: string; detail?: string };
  };
  /** 下载：`url` 必须含 `{file}`（据候选的 `file` 定位具体字幕） */
  fetch: SubHttpSpec;
}

/** 内置字幕源 id（插件不得占用；避免候选中 provider 字段歧义） */
export const RESERVED_SUBTITLE_IDS: readonly string[] = ['assrt', 'subtitlecat'];

/** 模板占位符白名单：search / fetch 各自可用的变量 */
export const SUB_PLACEHOLDERS_SEARCH: readonly string[] = ['keyword', 'keywords', 'title', 'ep'];
export const SUB_PLACEHOLDERS_FETCH: readonly string[] = ['file', 'subname', 'title', 'ep'];
/** 候选项映射字段白名单 */
export const SUB_MAP_FIELDS: readonly string[] = ['file', 'subname', 'title', 'lang', 'format', 'detail'];

/**
 * 校验 `contributes.subtitle.provider`（纯函数）。
 * ★ 只做**声明式**约束：URL 协议 / 占位符白名单 / JSON 路径语法 / 字段白名单。
 */
export function validateSubtitleProviderContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'subtitle.provider 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'subtitle.provider.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (RESERVED_SUBTITLE_IDS.includes(t.id)) {
    return { ok: false, reasonCode: 'SUBTITLE_ID_TAKEN', reason: `该字幕源 id 为内置源保留：${t.id}` };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'subtitle.provider.name 必填' };
  }
  const search = t.search as Record<string, unknown> | undefined;
  if (!search || typeof search !== 'object' || Array.isArray(search)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'search 必填（对象）' };
  }
  const su = providerUrlError(search.url, SUB_PLACEHOLDERS_SEARCH);
  if (su) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `search.url：${su}` };
  const sh = providerHeadersError(search.headers, SUB_PLACEHOLDERS_SEARCH);
  if (sh) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `search.headers：${sh}` };
  if (!isProviderPath(search.list)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: 'search.list 须是点号路径（如 data.list）' };
  }
  const map = search.map as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'search.map 必填（对象）' };
  }
  for (const k of Object.keys(map)) {
    if (!SUB_MAP_FIELDS.includes(k)) return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: `search.map 字段未知：${k}` };
  }
  for (const k of ['file', 'subname']) {
    if (!isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `search.map.${k} 必填且须是点号路径` };
  }
  for (const k of ['title', 'lang', 'format', 'detail']) {
    if (map[k] != null && !isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `search.map.${k} 须是点号路径` };
  }
  const fetch = t.fetch as Record<string, unknown> | undefined;
  if (!fetch || typeof fetch !== 'object' || Array.isArray(fetch)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'fetch 必填（对象）' };
  }
  for (const k of Object.keys(fetch)) {
    if (k !== 'url' && k !== 'headers') return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: `fetch 字段未知：${k}` };
  }
  const fu = providerUrlError(fetch.url, SUB_PLACEHOLDERS_FETCH);
  if (fu) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `fetch.url：${fu}` };
  if (!placeholdersOf(String(fetch.url)).includes('file')) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: 'fetch.url 必须含占位符 {file}' };
  }
  const fh = providerHeadersError(fetch.headers, SUB_PLACEHOLDERS_FETCH);
  if (fh) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `fetch.headers：${fh}` };
  return { ok: true };
}

/** 模板展开（值经 `encodeURIComponent`；未知占位符原样保留，仅供容错） */
export function expandSubTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (raw, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? encodeURIComponent(vars[name] ?? '') : raw,
  );
}

/** 受限 JSON 路径取值（任一段缺失 → undefined） */
export function jsonPathGet(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    const m = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\[(\d{1,3})\])?$/.exec(seg);
    if (!m) return undefined;
    cur = (cur as Record<string, unknown>)[m[1]];
    if (m[2] != null) cur = Array.isArray(cur) ? cur[Number(m[2])] : undefined;
  }
  return cur;
}
