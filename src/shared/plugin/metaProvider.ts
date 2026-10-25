import { ID_RE, type ValidateResult } from './core';
import { isProviderPath, providerHeadersError, providerUrlError } from './providerSchema';
import type { ProviderHttpSpec } from './providerSchema';

// ---------- ★ 元数据源契约（`contributes.meta.provider`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.5。与字幕源同为 **L2 声明式**（宿主代发请求，插件不跑代码）。
// ★ 命中口径 = 宿主现有 `MetaHit`：标题 / 年份 / 海报 / 简介 / 类型（+ 可选横图）。
//   v1 **不含评分**（宿主 UI 尚未展示评分）→ 声明 `rating` 字段会被拒。

/** `contributes` 里 `type:"meta.provider"` 的结构（L2 声明式元数据源） */
export interface MetaProviderContribute {
  type: 'meta.provider';
  /** 稳定 id；不得占用内置来源 `tmdb` / `douban` */
  id: string;
  name: string;
  search: ProviderHttpSpec & {
    /** 命中项的路径：**数组**（取第一项）或**单个对象**；空/非法 → 拒装 */
    list: string;
    /** 字段映射：源 JSON → 元数据命中（`title` 必填） */
    map: {
      title: string;
      year?: string;
      poster?: string;
      backdrop?: string;
      overview?: string;
      mediaType?: string;
    };
  };
  /** 海报 / 横图取到**相对路径**时的前缀（如 `https://img.cdn/t/p/w342`）；绝对 URL 不受影响 */
  imageBase?: string;
}

/** 内置元数据源 id（插件不得占用） */
export const RESERVED_META_IDS: readonly string[] = ['tmdb', 'douban'];

/** 元数据源模板占位符白名单 */
export const META_PLACEHOLDERS: readonly string[] = ['keyword', 'title', 'year'];
/** 元数据字段映射白名单（`rating` 等一律拒：宿主 UI 不展示 → 不提供假能力） */
export const META_MAP_FIELDS: readonly string[] = ['title', 'year', 'poster', 'backdrop', 'overview', 'mediaType'];

/**
 * 校验 `contributes.meta.provider`（纯函数）。
 * ★ 只做**声明式**约束；v1 与字幕源同边界（仅 GET / 仅 JSON / 无鉴权）。
 */
export function validateMetaProviderContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'meta.provider 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'meta.provider.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (RESERVED_META_IDS.includes(t.id)) {
    return { ok: false, reasonCode: 'META_ID_TAKEN', reason: `该元数据源 id 为内置来源保留：${t.id}` };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'meta.provider.name 必填' };
  }
  const search = t.search as Record<string, unknown> | undefined;
  if (!search || typeof search !== 'object' || Array.isArray(search)) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'search 必填（对象）' };
  }
  const su = providerUrlError(search.url, META_PLACEHOLDERS);
  if (su) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `search.url：${su}` };
  const sh = providerHeadersError(search.headers, META_PLACEHOLDERS);
  if (sh) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `search.headers：${sh}` };
  if (!isProviderPath(search.list)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: 'search.list 须是点号路径（如 data.results）' };
  }
  const map = search.map as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'search.map 必填（对象）' };
  }
  for (const k of Object.keys(map)) {
    if (!META_MAP_FIELDS.includes(k)) return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: `search.map 字段未知：${k}（v1 不提供评分等字段）` };
  }
  if (!isProviderPath(map.title)) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: 'search.map.title 必填且须是点号路径' };
  for (const k of META_MAP_FIELDS.filter((x) => x !== 'title')) {
    if (map[k] != null && !isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `search.map.${k} 须是点号路径` };
  }
  if (t.imageBase != null) {
    const ib = providerUrlError(t.imageBase, []);
    if (ib) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `imageBase：${ib}` };
  }
  for (const k of Object.keys(t)) {
    if (!['type', 'id', 'name', 'search', 'imageBase'].includes(k)) {
      return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: `meta.provider 字段未知：${k}` };
    }
  }
  return { ok: true };
}
