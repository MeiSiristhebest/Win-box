// src/main/plugin/pluginDiscoverSource.ts
// 插件发现页数据源适配层：把 `contributes.discover.source`（L2 **声明式**）适配为宿主「分区」提供者。
//
// ★ 与前两个 provider 同形态：宿主按 **URL 模板** 代发请求、按 **JSON 路径** 取数，**不执行插件的代码**。
// ★ 定位 = **增补**：宿主把插件分区**追加**在发现页现有榜单之后；内置分区先占 id，同 id 的插件分区被忽略。
// ★ 图片统一包成本地 `/img` 中继（与内置榜单同口径：渲染层直连图床可能被 DNS 污染）。
// ★ 单分区失败**只跳过该分区**（不拖垮同插件其它分区，也不影响内置榜单）。
// 事实源：docs/design/插件制作规范.md §5.6；机器契约见 src/shared/plugin.ts。
import { expandSubTemplate, jsonPathGet, type DiscoverSectionContribute, type DiscoverSourceContribute } from '../../shared/plugin';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import type { DiscoverItem, DiscoverSection } from '../../shared/types';
import { asText, fetchJson, headerSpec } from './providerHttp';

/** 发现页数据源（内置榜单与本接口同形，便于 `SpiderHost` 统一遍历） */
export interface DiscoverSource {
  id: string;
  name: string;
  /** 该源的全部**非空**分区（顺序 = 声明顺序） */
  sections(): Promise<DiscoverSection[]>;
}

/** 封面 / 横图 → 本地 `/img` 中继地址（相对路径先拼 `imageBase`；拼不出则返回空串，不产出坏图） */
function relayImage(v: unknown, base?: string): string {
  let s = asText(v).trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    if (!base) return '';
    s = `${base.replace(/\/+$/, '')}/${s.replace(/^\/+/, '')}`;
  }
  if (s.startsWith(LOCAL_PROXY_BASE)) return s; // 已是中继地址，别套两层
  return `${LOCAL_PROXY_BASE}/img?${new URLSearchParams({ u: s })}`;
}

/** 源里常写 `tv`/`TV Series`/`剧集` 等 → 归一为宿主口径 `movie | tv` */
function mediaTypeOf(v: unknown, fallback: 'movie' | 'tv'): 'movie' | 'tv' {
  const s = asText(v);
  if (!s) return fallback;
  return /tv|series|show|anime|剧|集/i.test(s) ? 'tv' : 'movie';
}

/** 取一个分区（空列表 → null，表示该分区不该出现） */
async function loadSection(sec: DiscoverSectionContribute): Promise<DiscoverSection | null> {
  const mt = sec.mediaType ?? 'movie';
  const vars = { mediaType: mt };
  const data = await fetchJson(expandSubTemplate(sec.url, vars), headerSpec(sec.headers, vars));
  const list = jsonPathGet(data, sec.list);
  if (!Array.isArray(list)) throw new Error(`响应里的 ${sec.list} 不是数组`);
  const m = sec.map;
  const items: DiscoverItem[] = [];
  for (const it of list) {
    const title = asText(jsonPathGet(it, m.title)).trim();
    if (!title) continue;
    const yearNum = m.year ? Number(asText(jsonPathGet(it, m.year)).replace(/[^\d]/g, '')) : NaN;
    const tmdbNum = m.tmdbId ? Number(asText(jsonPathGet(it, m.tmdbId)).replace(/[^\d]/g, '')) : NaN;
    const backdrop = m.backdrop ? relayImage(jsonPathGet(it, m.backdrop), sec.imageBase) : '';
    items.push({
      title,
      year: Number.isFinite(yearNum) && yearNum > 0 ? yearNum : '',
      poster: m.poster ? relayImage(jsonPathGet(it, m.poster), sec.imageBase) : '',
      mediaType: m.mediaType ? mediaTypeOf(jsonPathGet(it, m.mediaType), mt) : mt,
      ...(backdrop ? { backdrop } : {}),
      ...(Number.isFinite(tmdbNum) && tmdbNum > 0 ? { tmdbId: tmdbNum } : {}),
    });
  }
  if (!items.length) return null;
  return { id: sec.id, title: sec.title, mediaType: mt, items };
}

/** 声明式发现页数据源 → `DiscoverSource`（`id` 已由调用方去重） */
export function discoverSourceFromContribute(c: DiscoverSourceContribute): DiscoverSource {
  return {
    id: c.id,
    name: c.name,
    async sections(): Promise<DiscoverSection[]> {
      const out: DiscoverSection[] = [];
      for (const sec of c.sections) {
        try {
          const s = await loadSection(sec);
          if (s) out.push(s);
        } catch {
          /* 单分区失败只跳过：一个接口挂了不该让同插件的其它分区与内置榜单一起消失 */
        }
      }
      return out;
    },
  };
}
