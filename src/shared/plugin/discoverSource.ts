import { ID_RE, type ValidateResult } from './core';
import { isProviderPath, providerHeadersError as headersError, providerUrlError as urlError } from './providerSchema';

// ---------- ★ 发现页数据源契约（`contributes.discover.source`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.6。与前两者同为 **L2 声明式**（宿主代发请求，插件不跑代码）。
// ★ 定位 = **增补**：宿主把插件分区**追加**到发现页现有榜单之后（内置分区先占 id；同 id 的插件分区被忽略）。
// ★ v1 的 `map` **不含 `doubanId`** —— 该字段会让宿主去取「豆瓣剧照」，插件源并非豆瓣，映射过来会错配图源。

/** 发现页的一个**分区**（榜单分组）声明 */
export interface DiscoverSectionContribute {
  /** [a-z0-9-]{3,40}；同一插件内不得重复；与宿主内置分区同 id 时该分区被忽略 */
  id: string;
  /** 分区标题（发现页上那一行的标题） */
  title: string;
  /** 本分区的影片类型：决定 `{mediaType}` 占位符展开值，也是条目未映射 mediaType 时的缺省 */
  mediaType?: 'movie' | 'tv';
  /** 地址模板（可用 `{mediaType}`） */
  url: string;
  /** 额外请求头（键值皆禁 CRLF；禁用走私头） */
  headers?: Record<string, string>;
  /** 响应里**数组**所在的点号路径 */
  list: string;
  /** 本分区的图片相对路径前缀（可选） */
  imageBase?: string;
  /** 条目字段映射（`title` 必填） */
  map: { title: string; year?: string; poster?: string; backdrop?: string; mediaType?: string; tmdbId?: string };
}

/** `contributes` 里 `type:"discover.source"` 的结构（L2 声明式发现页数据源） */
export interface DiscoverSourceContribute {
  type: 'discover.source';
  id: string;
  name: string;
  /** 该插件贡献的分区（≥1；顺序即发现页上的显示顺序） */
  sections: DiscoverSectionContribute[];
}

/** 发现页模板占位符白名单 */
export const DISCOVER_PLACEHOLDERS: readonly string[] = ['mediaType'];
/** 发现页条目字段白名单（不含 `doubanId`：见本节说明） */
export const DISCOVER_MAP_FIELDS: readonly string[] = ['title', 'year', 'poster', 'backdrop', 'mediaType', 'tmdbId'];

/** 校验 `contributes.discover.source`（纯函数） */
export function validateDiscoverSourceContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'discover.source 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'discover.source.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'discover.source.name 必填' };
  }
  if (!Array.isArray(t.sections) || !t.sections.length) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'sections 必须是非空数组' };
  }
  const seen = new Set<string>();
  for (const s of t.sections) {
    const r = sectionError(s, seen);
    if (!r.ok) return r;
  }
  for (const k of Object.keys(t)) {
    if (!['type', 'id', 'name', 'sections'].includes(k)) {
      return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `discover.source 字段未知：${k}` };
    }
  }
  return { ok: true };
}

/** 单个分区声明校验（`seen` 用于同一插件内的 section id 去重） */
function sectionError(s: unknown, seen: Set<string>): ValidateResult {
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'sections 项非法' };
  }
  const sec = s as Record<string, unknown>;
  if (typeof sec.id !== 'string' || !ID_RE.test(sec.id)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'section.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (seen.has(sec.id)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section.id 在同一插件内重复：${sec.id}` };
  }
  seen.add(sec.id);
  if (typeof sec.title !== 'string' || !sec.title.trim()) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section(${sec.id}).title 必填` };
  }
  if (sec.mediaType != null && sec.mediaType !== 'movie' && sec.mediaType !== 'tv') {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section(${sec.id}).mediaType 须为 movie | tv` };
  }
  const u = urlError(sec.url, DISCOVER_PLACEHOLDERS);
  if (u) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `section(${sec.id}).url：${u}` };
  const h = headersError(sec.headers, DISCOVER_PLACEHOLDERS);
  if (h) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `section(${sec.id}).headers：${h}` };
  if (sec.imageBase != null) {
    const ib = urlError(sec.imageBase, []);
    if (ib) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `section(${sec.id}).imageBase：${ib}` };
  }
  if (!isProviderPath(sec.list)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `section(${sec.id}).list 须是点号路径` };
  }
  const map = sec.map as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section(${sec.id}).map 必填（对象）` };
  }
  for (const k of Object.keys(map)) {
    if (!DISCOVER_MAP_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section(${sec.id}).map 字段未知：${k}（v1 不含 doubanId）` };
    }
  }
  if (!isProviderPath(map.title)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `section(${sec.id}).map.title 必填且须是点号路径` };
  }
  for (const k of DISCOVER_MAP_FIELDS.filter((x) => x !== 'title')) {
    if (map[k] != null && !isProviderPath(map[k])) {
      return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `section(${sec.id}).map.${k} 须是点号路径` };
    }
  }
  for (const k of Object.keys(sec)) {
    if (!['id', 'title', 'mediaType', 'url', 'headers', 'list', 'imageBase', 'map'].includes(k)) {
      return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section 字段未知：${k}` };
    }
  }
  return { ok: true };
}
