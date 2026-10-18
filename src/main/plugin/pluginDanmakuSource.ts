// src/main/plugin/pluginDanmakuSource.ts
// 插件弹幕源适配层：把 `contributes.danmaku.source`（L2 **声明式**）适配为宿主的三步弹幕源。
//
// ★ 弹幕是**三步链路**（与内置 logvar 源同形）：
//   ① search（关键词 → 番剧候选） ② episodes（番剧 → 剧集候选） ③ comment（剧集 → 弹幕 **XML**）
//   三步之间靠**source 键**路由：插件源合成 `plugin:<contributeId>`（内置源用的是接口基础地址）。
// ★ 插件不产出解析结果：第 ③ 步只把 **XML 文本**交给宿主，由引擎的弹幕解析器消费。
// 事实源：docs/design/插件制作规范.md §5.7；机器契约见 src/shared/plugin.ts。
import { expandSubTemplate, jsonPathGet, type DanmakuSourceContribute } from '../../shared/plugin';
import type { DanmakuAnime, DanmakuCandidate } from '../../shared/danmaku';
import { asText, fetchJson, fetchText, headerSpec } from './providerHttp';

/** 弹幕源（内置 logvar 型源与本接口同形，便于 `SpiderHost` 统一遍历） */
export interface DanmakuSource {
  /** 合成 source 键（`plugin:<contributeId>`；写入 `DanmakuAnime.source` / `DanmakuCandidate.source`） */
  key: string;
  name: string;
  /** ① 搜索番剧候选（失败抛错，由调用方记冷却） */
  search(keyword: string, season?: number): Promise<DanmakuAnime[]>;
  /** ② 取该番剧的剧集候选 */
  episodes(animeId: number, animeTitle?: string): Promise<DanmakuCandidate[]>;
  /** ③ 拉弹幕 XML 文本（空弹幕合法返回 ''） */
  comment(episodeId: number): Promise<string>;
}

/** 声明式弹幕源 → `DanmakuSource`（`key` 由 contribute id 合成） */
export function danmakuSourceFromContribute(c: DanmakuSourceContribute): DanmakuSource {
  const key = `plugin:${c.id}`;
  const name = c.name;
  const sm = c.search.map;
  const em = c.episodes.map;
  return {
    key,
    name,
    async search(keyword: string, season?: number): Promise<DanmakuAnime[]> {
      const vars = { keyword, season: season ? String(season) : '' };
      const data = await fetchJson(expandSubTemplate(c.search.url, vars), headerSpec(c.search.headers, vars));
      const list = jsonPathGet(data, c.search.list);
      if (!Array.isArray(list)) throw new Error(`响应里的 ${c.search.list} 不是数组`);
      const out: DanmakuAnime[] = [];
      for (const it of list) {
        const animeId = Number(asText(jsonPathGet(it, sm.animeId)));
        const title = asText(jsonPathGet(it, sm.title)).trim();
        if (!Number.isFinite(animeId) || animeId <= 0 || !title) continue;
        const bg = sm.bangumiId ? Number(asText(jsonPathGet(it, sm.bangumiId))) : NaN;
        const ec = sm.episodeCount ? Number(asText(jsonPathGet(it, sm.episodeCount))) : NaN;
        const kind = sm.kind ? asText(jsonPathGet(it, sm.kind)).trim() : '';
        out.push({
          animeId,
          bangumiId: Number.isFinite(bg) && bg > 0 ? bg : animeId,
          title,
          source: key,
          sourceName: name,
          ...(kind ? { kind } : {}),
          ...(Number.isFinite(ec) && ec > 0 ? { episodeCount: ec } : {}),
        });
      }
      return out;
    },
    async episodes(animeId: number, animeTitle?: string): Promise<DanmakuCandidate[]> {
      const vars = { animeId: String(animeId), title: animeTitle ?? '' };
      const data = await fetchJson(expandSubTemplate(c.episodes.url, vars), headerSpec(c.episodes.headers, vars));
      const list = jsonPathGet(data, c.episodes.list);
      if (!Array.isArray(list)) throw new Error(`响应里的 ${c.episodes.list} 不是数组`);
      const out: DanmakuCandidate[] = [];
      for (const it of list) {
        const id = Number(asText(jsonPathGet(it, em.episodeId)));
        if (!Number.isFinite(id) || id <= 0) continue;
        const epTitle = em.episodeTitle ? asText(jsonPathGet(it, em.episodeTitle)).trim() : '';
        const epNum = em.episodeNumber ? asText(jsonPathGet(it, em.episodeNumber)).trim() : '';
        out.push({
          episodeId: id,
          source: key,
          sourceName: name,
          title: animeTitle || undefined,
          ...(epTitle ? { episodeTitle: epTitle } : {}),
          ...(epNum && /^\d{1,4}$/.test(epNum) ? { episodeNumber: epNum } : {}),
        });
      }
      return out;
    },
    async comment(episodeId: number): Promise<string> {
      const vars = { episodeId: String(episodeId) };
      const text = (await fetchText(expandSubTemplate(c.comments.url, vars), headerSpec(c.comments.headers, vars))).trim();
      if (!text.startsWith('<')) throw new Error('响应不是 XML');
      return text;
    },
  };
}
