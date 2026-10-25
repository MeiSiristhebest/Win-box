import { ID_RE, type ValidateResult } from './core';
import { isProviderPath, placeholdersOf, providerHeadersError, providerUrlError } from './providerSchema';
import type { ProviderHttpSpec } from './providerSchema';

// ---------- ★ 弹幕源契约（`contributes.danmaku.source`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.7。**L2 声明式**（宿主代发请求，插件不跑代码）。
// ★ 弹幕是**三步链路**（宿主既有做法，见 main/danmaku/logvarProvider.ts）：
//   ① 搜索番剧（关键词）→ ② 取该番剧的剧集列表 → ③ 按剧集 id 拉**弹幕 XML**（B 站格式）。
//   三步各一段受限模板；弹幕数据由宿主的引擎解析器消费（插件不产出解析结果）。
// ★ v1 的弹幕数据**只收 XML 文本**（B 站格式）。源若只给 JSON 弹幕 → 用 `kind:"code"`（L4）。

/** 弹幕「搜索番剧」段 */
export interface DanmakuSearchSpec extends ProviderHttpSpec {
  /** 响应里**数组**所在的点号路径 */
  list: string;
  /** 番剧字段映射（`animeId` / `title` 必填；`bangumiId` 缺省用 `animeId`） */
  map: { animeId: string; title: string; bangumiId?: string; episodeCount?: string; kind?: string };
}

/** 弹幕「取剧集列表」段 */
export interface DanmakuEpisodesSpec extends ProviderHttpSpec {
  list: string;
  /** 剧集字段映射（`episodeId` 必填） */
  map: { episodeId: string; episodeTitle?: string; episodeNumber?: string };
}

/** `contributes` 里 `type:"danmaku.source"` 的结构（L2 声明式弹幕源） */
export interface DanmakuSourceContribute {
  type: 'danmaku.source';
  /** 稳定 id（宿主合成 source 键 `plugin:<contributeId>`，供候选/剧集/弹幕三步间路由） */
  id: string;
  name: string;
  search: DanmakuSearchSpec;
  episodes: DanmakuEpisodesSpec;
  /** 拉弹幕：`url` 必须含 `{episodeId}`，响应须是**XML 文本** */
  comments: ProviderHttpSpec;
}

/** 三段各自的模板占位符白名单 */
export const DANMAKU_SEARCH_PLACEHOLDERS: readonly string[] = ['keyword', 'season'];
export const DANMAKU_EPISODES_PLACEHOLDERS: readonly string[] = ['animeId', 'title'];
export const DANMAKU_COMMENTS_PLACEHOLDERS: readonly string[] = ['episodeId'];
/** 两段字段映射白名单 */
export const DANMAKU_ANIME_MAP_FIELDS: readonly string[] = ['animeId', 'title', 'bangumiId', 'episodeCount', 'kind'];
export const DANMAKU_EPISODE_MAP_FIELDS: readonly string[] = ['episodeId', 'episodeTitle', 'episodeNumber'];

/** 校验 `contributes.danmaku.source`（纯函数） */
export function validateDanmakuSourceContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: 'danmaku.source 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: 'danmaku.source.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: 'danmaku.source.name 必填' };
  }
  for (const k of Object.keys(t)) {
    if (!['type', 'id', 'name', 'search', 'episodes', 'comments'].includes(k)) {
      return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `danmaku.source 字段未知：${k}` };
    }
  }
  const r = danmakuStepError(t, 'search');
  if (r) return r;
  const r2 = danmakuStepError(t, 'episodes');
  if (r2) return r2;
  const r3 = danmakuStepError(t, 'comments');
  if (r3) return r3;
  return { ok: true };
}

/** 校验弹幕三步里的某一段（返回 error；undefined = 该段合法） */
function danmakuStepError(t: Record<string, unknown>, step: 'search' | 'episodes' | 'comments'): ValidateResult | undefined {
  const spec = t[step] as Record<string, unknown> | undefined;
  const label = `danmaku.source.${step}`;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label} 必填（对象）` };
  }
  const placeholders =
    step === 'search' ? DANMAKU_SEARCH_PLACEHOLDERS : step === 'episodes' ? DANMAKU_EPISODES_PLACEHOLDERS : DANMAKU_COMMENTS_PLACEHOLDERS;
  const u = providerUrlError(spec.url, placeholders);
  if (u) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `${label}.url：${u}` };
  const h = providerHeadersError(spec.headers, placeholders);
  if (h) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `${label}.headers：${h}` };
  if (step === 'comments') {
    if (!placeholdersOf(String(spec.url)).includes('episodeId')) {
      return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `${label}.url 必须含占位符 {episodeId}` };
    }
    for (const k of Object.keys(spec)) {
      if (k !== 'url' && k !== 'headers') return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label} 字段未知：${k}` };
    }
    return undefined;
  }
  if (!isProviderPath(spec.list)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `${label}.list 须是点号路径` };
  }
  const map = spec.map as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label}.map 必填（对象）` };
  }
  const fields = step === 'search' ? DANMAKU_ANIME_MAP_FIELDS : DANMAKU_EPISODE_MAP_FIELDS;
  const required = step === 'search' ? ['animeId', 'title'] : ['episodeId'];
  for (const k of Object.keys(map)) {
    if (!fields.includes(k)) return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label}.map 字段未知：${k}` };
  }
  for (const k of required) {
    if (!isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `${label}.map.${k} 必填且须是点号路径` };
  }
  for (const k of fields.filter((x) => !required.includes(x))) {
    if (map[k] != null && !isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `${label}.map.${k} 须是点号路径` };
  }
  for (const k of Object.keys(spec)) {
    if (!['url', 'headers', 'list', 'map'].includes(k)) {
      return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label} 字段未知：${k}` };
    }
  }
  return undefined;
}
