// src/engine/parse/Movie.ts
// 苹果 CMS 统一数据模型（Movie/Video/UrlBean/UrlInfo/AbsXml）+ JSON→Movie 解析。
// 1:1 对齐 ref3/.../bean/AbsJson.java 的 toAbsXml()。
import { safeJsonString, safeJsonInt } from '../util/json';
import { normalizeVodId, normalizeVodPic } from '../vod/itemNormalize';
import type { FilterGroup } from '../../shared/types';

export interface UrlInfo {
  flag: string;
  urls: string; // 原始播放串：第01集$url1#第02集$url2（安卓原样保留）
}

export interface VideoUrlBean {
  infoList: UrlInfo[];
}

export interface Video {
  id: string;
  tid: number;
  name: string;
  type: string;
  pic: string;
  lang: string;
  area: string;
  year: number;
  state: string;
  note: string;
  actor: string;
  director: string;
  des: string;
  tag: string;
  action: string;
  last: string;
  urlBean: VideoUrlBean;
}

export interface Movie {
  page: number;
  pagecount: number;
  pagesize: number;
  recordcount: number;
  videoList: Video[];
}

export interface AbsXml {
  sourceKey: string;
  searchToken: string;
  movie: Movie | null;
  msg: string;
}

function s(v: unknown): string {
  return v == null ? '' : String(v);
}
function toInt(v: unknown, def = 0): number {
  const n = parseInt(s(v), 10);
  return Number.isNaN(n) ? def : n;
}

/** 单条 vod（AbsJsonVod）→ Video（AbsJson.java:109 toXmlVideo） */
export function vodToVideo(vod: Record<string, unknown>): Video {
  const playFrom = s(vod['vod_play_from']);
  const playUrl = s(vod['vod_play_url']);
  const infoList: UrlInfo[] = [];
  if (playFrom.length > 0 && playUrl.length > 0) {
    const flags = playFrom.split('$$$');
    const urls = playUrl.split('$$$');
    for (let i = 0; i < flags.length && i < urls.length; i++) {
      const f = flags[i].trim();
      const u = urls[i].trim();
      if (f.length === 0 || u.length === 0) continue;
      infoList.push({ flag: f, urls: u });
    }
  }
  return {
    // ★ 空 id → 片名兜底；封面拆上游 `@Referer=…` 尾巴（见 vod/itemNormalize.ts）
    id: normalizeVodId(vod['vod_id'], vod['vod_name']),
    tid: toInt(vod['type_id'], 0),
    name: s(vod['vod_name']),
    type: s(vod['type_name']),
    pic: normalizeVodPic(vod['vod_pic']),
    lang: s(vod['vod_lang']),
    area: s(vod['vod_area']),
    year: toInt(vod['vod_year'], 0),
    state: s(vod['vod_state']),
    note: s(vod['vod_remarks']),
    actor: s(vod['vod_actor']),
    director: s(vod['vod_director']),
    des: s(vod['vod_content']),
    tag: s(vod['vod_tag']),
    action: s(vod['action']),
    last: s(vod['vod_time']),
    urlBean: { infoList },
  };
}

/** AbsJson.toAbsXml() —— JSON 响应 → 统一 Movie/AbsXml */
export function parseAbsJson(jsonText: string, sourceKey = ''): AbsXml | null {
  try {
    const root = JSON.parse(jsonText) as Record<string, unknown>;
    const listRaw = root['list'];
    const videoList: Video[] = [];
    if (Array.isArray(listRaw)) {
      for (const vod of listRaw) {
        try {
          videoList.push(vodToVideo(vod as Record<string, unknown>));
        } catch {
          // 与上游一致：单条失败跳过
        }
      }
    }
    const movie: Movie = {
      page: toInt(root['page'], 0),
      pagecount: toInt(root['pagecount'], 0),
      pagesize: toInt(root['limit'], 0),
      recordcount: toInt(root['total'], 0),
      videoList,
    };
    return { sourceKey, searchToken: '', movie, msg: s(root['msg']) };
  } catch {
    return null;
  }
}

/** 解析首页分类（class 数组）—— sortJson 部分 */
export interface SortClass {
  /** 分类 id：保留源站原样字符串（真实生态存在非数字 id，如字母/复合键，Number 化会丢数据） */
  id: string;
  name: string;
  /** 可选筛选标记（type_flag），部分源用于分类筛选联动 */
  flag?: string;
  /** 分类筛选分组（上游 CMS JSON 的 class[].filters），供 UI 渲染筛选面板 */
  filters?: FilterGroup[];
}

/**
 * ★ 2026-10-15（用户报「有的源应该有分类，但点播页没有分类」）：`class` 字段的**形态兜底**。
 *   原实现只认「数组」一种形态，其它形态会被整段丢弃且**不报错** —— UI 上就是「这个源没有分类」。
 *   这里统一归一成「对象数组」（元素仍是原始键值对，id/name 的取值交给各调用方），覆盖：
 *     · 标准数组：`[{type_id,type_name}]`（CMS JSON / 蜘蛛 homeContent）
 *     · 对象 map：`{"1":"电影","2":"剧集"}` → 键当 id、值当名称
 *     · 对象 map 带对象值：`{"1":{name:"电影"}}` → 键当 id 兜底，条目自带字段优先
 *   注：数组里的非对象元素（如 `["电影","剧集"]`）**仍然丢弃** —— 没有 id 就无法发起分类请求，
 *   硬把下标当 id 会得到一堆必然失败的分类，比「没有分类」更糟。
 */
export function normalizeClassList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? { type_id: k, ...(v as Record<string, unknown>) }
        : { type_id: k, type_name: v == null ? '' : String(v) },
    );
  }
  return [];
}

/**
 * 单个筛选组 → FilterGroup。`rawKey` = 对象 map 的键（数组形态下用条目自带的 `key`）。
 * ★ 2026-10-15：`filters[type_id]` 在真源里是**数组** `[{key,name,value:[{n,v}]}]` 而不是 `{key:{…}}`，
 *   两种情况都归一成同一形状（`tab` 只在少数源出现，缺失即空串）。
 */
function toFilterGroup(rawKey: string, f: unknown): FilterGroup {
  const o = (f || {}) as Record<string, unknown>;
  const valAr = Array.isArray(o['value'])
    ? (o['value'] as Record<string, unknown>[])
    : Array.isArray(o['values'])
      ? (o['values'] as Record<string, unknown>[])
      : [];
  return {
    key: s(o['key'] ?? o['k']).trim() || rawKey,
    name: s(o['name'] ?? o['key'] ?? o['k'] ?? rawKey),
    // 选项字段多键兜底：主流是 {n,v}；部分源给 {name,value} / {tab,n,v}
    // ★ 注意「显式空值」语义：`v: ''` 是源自己的「全部」档，**必须保留**（不能因为空串就回退成 n）
    value: valAr
      .map((it) => {
        const n = s(it['n'] ?? it['name'] ?? it['title'] ?? it['tab']);
        const rawV = it['v'] ?? it['value'] ?? it['val'];
        return { tab: s(it['tab']), n, v: rawV == null ? n : s(rawV) };
      })
      .filter((it) => it.n.length > 0 || it.v.length > 0),
  };
}

/**
 * 筛选组归一成 FilterGroup[]；非法/空直接 []。★★ 2026-10-15（用户报「你还是没拿到源的分类」）★★：
 * 真源（drpy / csp_ jar 的 `Result.filters()`）给的是**数组**：`filters[type_id] = [{key,name,value:[{n,v}]}]`；
 * 而部分源/历史 mock 用**对象 map**：`{key:{name,value:[…]}}`。此前只认后者 ⇒ 遇到数组直接 return []，
 * 真源的筛选组（类型/地区/年份/排序/资费/推荐…）**整段丢掉** ⇒ 点播页四维被判不可用而隐藏。
 */
export function parseFilters(filtersRaw: unknown): FilterGroup[] {
  if (!filtersRaw) return [];
  try {
    // 形态 A（主流）：数组 [{key,name,value}]
    if (Array.isArray(filtersRaw)) {
      return (filtersRaw as unknown[]).map((f, i) => toFilterGroup(String(i), f)).filter((g) => g.value.length > 0);
    }
    if (typeof filtersRaw !== 'object') return [];
    // 形态 B：对象 map {key:{name,value}}
    return Object.entries(filtersRaw as Record<string, unknown>)
      .map(([key, f]) => toFilterGroup(key, f))
      .filter((g) => g.value.length > 0);
  } catch {
    return [];
  }
}
/**
 * ★★ 2026-10-15（用户报「你还是没拿到源的分类」）★★：**filters 的形态兜底** —— 本仓库此前的真 Bug。
 *
 * TVBox / FongMi 蜘蛛协议里 `homeContent` 的筛选组有**两种写法**：
 *   · 内嵌：`class:[{type_id, type_name, filters:{ area:{name,value:[…]} }}]`（部分源 / 本仓库早期 mock 用）；
 *   · **顶层键控（主流）**：`{ class:[…], filters:{ "<type_id>": { class:{…}, area:{…}, year:{…} } }, list:[…] }`
 *     —— drpy 的 `homeContent` 与 jar 蜘蛛的 `Result.filters()` 都是这一种。
 *
 * 此前只读**内嵌**那一份 ⇒ 真源（drpy / csp_ jar）的筛选组整段丢掉 ⇒ 点播页四维被判「不可用」而隐藏
 * （观感 =「只有源的分类」）。这里先取内嵌，为空再回退「顶层 `filters[该分类 id]`」。
 */
export function classFiltersFor(
  root: Record<string, unknown> | null | undefined,
  entry: Record<string, unknown>,
  classId: string,
  index = -1,
): FilterGroup[] {
  // ① 内嵌在分类条目里（少数源）
  const own = parseFilters(entry['filters']);
  if (own.length > 0) return own;
  const top = root ? root['filters'] : undefined;
  if (!top || typeof top !== 'object' || Array.isArray(top)) return [];
  const map = top as Record<string, unknown>;
  // ② 顶层按 type_id 键控（主流）。键可能不是同一个串（数字 id / 下划线前缀）→ 顺带试几种写法
  for (const k of [classId, String(index)]) {
    if (k === '' || k === '-1') continue;
    const byId = map[k];
    if (!byId) continue;
    const g = parseFilters(byId);
    if (g.length > 0) return g;
  }
  // ③ 顶层本身就是「通用的组 map」（`{area:{name,value}}`，对该源所有分类生效）。
  //    ★ 判定从严：**每个值都必须是组对象**（不是数组）才走这条 —— 否则会把「按分类键控」的那份
  //      （值 = 组数组）误当成通用组，把别的分类的筛选组混进来。
  const isFlatGroupMap = Object.values(map).every((v) => !!v && typeof v === 'object' && !Array.isArray(v));
  return isFlatGroupMap ? parseFilters(map) : [];
}

export function parseSortJson(jsonText: string): SortClass[] {
  try {
    const root = JSON.parse(jsonText) as Record<string, unknown>;
    return normalizeClassList(root['class'])
      .map((o, i) => {
        const id = s(o['type_id'] ?? o['id'] ?? o['tid']).trim();
        const filters = classFiltersFor(root, o, id, i);
        return {
          id,
          name: s(o['type_name'] ?? o['name'] ?? o['title']).trim(),
          flag: o['type_flag'] != null ? String(o['type_flag']) : undefined,
          // 仅当有筛选才带上 filters，保持无筛选源的对象形状与历史一致（测试/调用方 toEqual 兼容）
          ...(filters.length > 0 ? { filters } : {}),
        };
      })
      .filter((c) => c.name.length > 0 && c.id.length > 0);
  } catch {
    return [];
  }
}
