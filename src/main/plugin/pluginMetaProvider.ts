// src/main/plugin/pluginMetaProvider.ts
// 插件元数据源适配层：把 `contributes.meta.provider`（L2 **声明式**）适配为宿主的元数据来源。
//
// ★ 与字幕源同形态：宿主按 **URL 模板** 代发请求、按 **JSON 路径** 取数，**不执行插件的代码**。
// ★ 命中口径 = 宿主既有 `MetaHit`（标题 / 年份 / 海报 / 简介 / 类型 / 可选横图）；**v1 不含评分**。
// ★ 位置：插件元数据源是**兜底**（内置 TMDB → 豆瓣 都未命中时才轮到它；见 SpiderHost.metaSearch）——
//   不抢占内置来源，也不写入内置的 `meta.json` 查询缓存（避免停用插件后仍被旧缓存命中）。
// 事实源：docs/design/插件制作规范.md §5.5；机器契约见 src/shared/plugin.ts。
import { expandSubTemplate, jsonPathGet, type MetaProviderContribute } from '../../shared/plugin';
import type { MetaHit } from '../../shared/types';
import { asText, fetchJson, headerSpec } from './providerHttp';

/** 元数据来源（内置的 tmdb/douban 与本接口同形，便于 `SpiderHost` 统一遍历） */
export interface MetaProvider {
  /** 稳定 id（内置 `tmdb` / `douban`；插件源为其 `meta.provider.id`） */
  id: string;
  name: string;
  /** 检索：命中返回 `MetaHit`，无命中返回 null；抛错由调用方吞掉并记日志 */
  search(ctx: { title: string; year?: string }): Promise<MetaHit | null>;
}

/** 图片字段：绝对 URL 原样用；相对路径拼 `imageBase`（未声明则丢弃，不产出坏图） */
function imageUrl(v: unknown, base?: string): string | undefined {
  const s = asText(v).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (!base) return undefined;
  return `${base.replace(/\/+$/, '')}/${s.replace(/^\/+/, '')}`;
}

/** 源里常写 `tv`/`TV Series`/`剧集` 等 → 归一为宿主口径 `movie | tv`（认不出按电影） */
function mediaType(v: unknown): 'movie' | 'tv' {
  return /tv|series|show|anime|剧|集/i.test(asText(v)) ? 'tv' : 'movie';
}

/** 声明式元数据源 → `MetaProvider`（`id` 已由调用方去重） */
export function metaProviderFromContribute(c: MetaProviderContribute): MetaProvider {
  const m = c.search.map;
  return {
    id: c.id,
    name: c.name,
    async search(ctx: { title: string; year?: string }): Promise<MetaHit | null> {
      const vars = { keyword: ctx.title, title: ctx.title, year: ctx.year ?? '' };
      const data = await fetchJson(expandSubTemplate(c.search.url, vars), headerSpec(c.search.headers, vars));
      // `list` 指向数组 → 取第一项；指向单个对象 → 直接用（两种响应形态都常见）
      const node = jsonPathGet(data, c.search.list);
      const item = Array.isArray(node) ? node[0] : node;
      if (!item || typeof item !== 'object') return null;
      const title = asText(jsonPathGet(item, m.title)).trim();
      if (!title) return null;
      const yearNum = m.year ? Number(asText(jsonPathGet(item, m.year)).replace(/[^\d]/g, '')) : NaN;
      const backdrop = m.backdrop ? imageUrl(jsonPathGet(item, m.backdrop), c.imageBase) : undefined;
      return {
        title,
        year: Number.isFinite(yearNum) && yearNum > 0 ? yearNum : '',
        poster: (m.poster ? imageUrl(jsonPathGet(item, m.poster), c.imageBase) : undefined) ?? '',
        overview: m.overview ? asText(jsonPathGet(item, m.overview)) : '',
        type: m.mediaType ? mediaType(jsonPathGet(item, m.mediaType)) : 'movie',
        ...(backdrop ? { backdrop } : {}),
      };
    },
  };
}
