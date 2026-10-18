// src/main/plugin/pluginSubtitleProvider.ts
// 插件字幕源适配层：把 `contributes.subtitle.provider`（L2 **声明式**）适配为宿主的 SubtitleProvider。
//
// ★ 全部声明式：宿主按插件的 **URL 模板** 代发请求、按 **JSON 路径** 取数 —— **不执行插件的代码**。
//   （这也是 L2 不需要 `permissions` 的原因：出网由宿主做，插件只描述"去哪儿取、取哪些字段"。）
// ★ v1 仅 GET；请求头/取文本/取值等共用细节见 providerHttp.ts（与元数据源等同一份实现）。
// 事实源：docs/design/插件制作规范.md §5.4；机器契约见 src/shared/plugin.ts。
import { expandSubTemplate, jsonPathGet, type SubtitleProviderContribute } from '../../shared/plugin';
import type { SubtitleCandidate, SubtitleFetchResult, SubtitleSettings } from '../../shared/subtitle';
import { providerEnabled, type SubtitleProvider, type SubtitleSearchContext } from '../subtitle/provider';
import { getBuffer } from '../subtitle/http';
import { subtitleFromBytes } from '../subtitle/assrtProvider';
import { asText, fetchJson, headerSpec } from './providerHttp';

/** 声明式字幕源 → 宿主 SubtitleProvider（`id` 已由调用方去重） */
export function subtitleProviderFromContribute(c: SubtitleProviderContribute): SubtitleProvider {
  const id = c.id;
  const m = c.search.map;
  return {
    id,
    name: c.name,
    needsToken: false,
    available(settings: SubtitleSettings): { ok: boolean; reason?: string } {
      return providerEnabled(settings, id) ? { ok: true } : { ok: false, reason: '已在字幕设置中关闭' };
    },
    async search(ctx: SubtitleSearchContext): Promise<SubtitleCandidate[]> {
      const vars = {
        keyword: ctx.keywords[0] ?? '',
        keywords: ctx.keywords.join(' '),
        title: ctx.title,
        ep: ctx.ep ?? '',
      };
      const data = await fetchJson(expandSubTemplate(c.search.url, vars), headerSpec(c.search.headers, vars));
      const list = jsonPathGet(data, c.search.list);
      if (!Array.isArray(list)) throw new Error(`响应里的 ${c.search.list} 不是数组`);
      const out: SubtitleCandidate[] = [];
      for (const item of list) {
        const file = asText(jsonPathGet(item, m.file));
        const subname = asText(jsonPathGet(item, m.subname));
        if (!file || !subname) continue;
        out.push({
          file,
          subname,
          provider: id,
          title: m.title ? asText(jsonPathGet(item, m.title)) || undefined : undefined,
          lang: m.lang ? asText(jsonPathGet(item, m.lang)) || undefined : undefined,
          format: m.format ? asText(jsonPathGet(item, m.format)) || undefined : undefined,
          detail: m.detail ? asText(jsonPathGet(item, m.detail)) || undefined : undefined,
        });
      }
      return out;
    },
    async fetch(candidate: SubtitleCandidate, ctx: SubtitleSearchContext): Promise<SubtitleFetchResult> {
      const vars = {
        file: candidate.file,
        subname: candidate.subname ?? '',
        title: candidate.title ?? ctx.title,
        ep: ctx.ep ?? '',
      };
      const buf = await getBuffer(expandSubTemplate(c.fetch.url, vars), headerSpec(c.fetch.headers, vars));
      if (!buf) return { text: '', fileName: '', reason: '字幕下载失败（地址失效或网络异常）' };
      return subtitleFromBytes(buf, { fileName: candidate.subname || '', videoName: candidate.subname || '' });
    },
  };
}
