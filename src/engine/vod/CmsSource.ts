// src/engine/vod/CmsSource.ts
// 苹果 CMS（type 0 XML / type 1 JSON）源处理。安卓在 SourceViewModel 内联处理 type 0/1/4，
// 不走 Spider；此处抽成 CmsSource 保持等价控制流。URL 约定对齐 SourceViewModel.java:485/535/629。
import type { HttpClient, Logger } from '../../shared/types';
import type { AbsXml, SortClass } from '../parse/Movie';
import type { SourceCatalogResult } from './SourcePorts';
import { parseAbsJson, parseSortJson } from '../parse/Movie';
import { parseAbsXml, parseSortXml } from '../parse/AbsXml';
import { movieToVodItems, movieToVodDetail } from './VodNormalizer';
import type { VodItem, VodDetail } from '../../shared/types';
import { SourceProblemError } from '../spider/errors';
import { abortError, throwIfAborted } from '../util/abort';

function withQuery(api: string, params: Record<string, string>): string {
  const u = new URL(api, 'http://x'); // 兼容相对
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') u.searchParams.set(k, v);
  }
  // 若 api 是绝对 URL，用原 origin+pathname+search
  if (/^https?:\/\//.test(api)) {
    return api.split('?')[0] + (u.search || '');
  }
  return api + (u.search || '');
}

/**
 * ★ 2026-09-25：响应是否「像 CMS 数据」（XML / JSON）。
 * 用来识别 **DNS 污染**：系统 DNS 被解到劫持 IP 时，返回的是运营商反诈页/落地页（HTML），
 * 换 DoH 重取即可恢复。`<!DOCTYPE html>` / `<html` 明确判为「不是数据」。
 */
export function looksLikeCmsBody(text: string): boolean {
  const s = (text || '').replace(/^\uFEFF/, '').trimStart();
  if (!s) return false;
  const head = s.slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return false;
  return s.startsWith('<') || s.startsWith('{') || s.startsWith('[');
}

export type CmsResult = SourceCatalogResult;

/** CMS adapter needs only outbound HTTP and one informational log capability. */
export interface CmsSourceHost {
  http: Pick<HttpClient, 'request'>;
  logger: Pick<Logger, 'i'>;
}

/** Wall-clock access is an outer adapter so request budgets can be tested deterministically. */
export interface CmsSourceClockPort {
  now(): number;
}

export class CmsSource {
  constructor(
    private host: CmsSourceHost,
    private readonly clock: CmsSourceClockPort = { now: () => Date.now() },
  ) {}

  private async fetchText(url: string, timeoutMs?: number, signal?: AbortSignal): Promise<string> {
    const budgetMs = Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0 ? Math.floor(timeoutMs!) : 20000;
    const deadline = this.clock.now() + budgetMs;
    // 任务 A1：网络层失败（超时/连接异常/非 2xx）包成 NETWORK 中文错误向上抛，
    // 不再让原始 undici 报错直接冒出、也不静默返回空给 UI。
    const get = async (doh: 0 | 1): Promise<string> => {
      let res;
      try {
        throwIfAborted(signal);
        const remainingMs = Math.max(1, deadline - this.clock.now());
        res = await this.host.http.request({
          url,
          method: 'get',
          timeoutMs: remainingMs,
          totalTimeoutMs: remainingMs,
          ...(signal ? { signal } : {}),
          ...(doh ? { doh } : {}),
        });
      } catch (e) {
        if (signal?.aborted) throw abortError(signal);
        const msg = e instanceof Error ? e.message : String(e);
        throw new SourceProblemError('NETWORK', `网络请求失败（${url}）：${msg}`, e);
      }
      if (res.status && res.status >= 400) {
        throw new SourceProblemError('NETWORK', `站点返回 HTTP ${res.status}（${url}）`);
      }
      const c = res.content;
      return Array.isArray(c) ? Buffer.from(c).toString('utf-8') : c;
    };
    const text = await get(0);
    if (looksLikeCmsBody(text)) return text;
    // ★ 2026-09-25：响应不像 XML/JSON（多半是**域名被 DNS 污染**后拿到的运营商劫持页/落地页）
    //   → 用 DoH 解析真实 IP 再取一次；DoH 也不成则交回第一次的结果（保持原有错误路径与文案）。
    throwIfAborted(signal);
    if (this.clock.now() >= deadline) return text;
    try {
      const t2 = await get(1);
      if (looksLikeCmsBody(t2)) {
        this.host.logger.i(`cms: ${url} 系统 DNS 响应异常，已按 DoH 重取成功`);
        return t2;
      }
    } catch {
      if (signal?.aborted) throw abortError(signal);
      /* DoH 同样失败：下面的 return 会把第一次的结果交出去 */
    }
    return text;
  }

  private ac(type: number): string {
    return type === 0 ? 'videolist' : 'detail';
  }

  private parseSort(text: string, type: number): SortClass[] {
    return type === 0 ? parseSortXml(text) : parseSortJson(text);
  }

  private parseBody(text: string, type: number, sourceKey: string): AbsXml | null {
    return type === 0 ? parseAbsXml(text, sourceKey) : parseAbsJson(text, sourceKey);
  }

  /** 首页：GET api → 分类 + 推荐。
   * 兼容"裸地址只回分类不回列表"的 CMS：若解析到分类但首页无条目，
   * 自动回退拉第一个分类的第 1 页作为首页内容（homeFallback=true），根治有效源首页空白。 */
  async home(api: string, type: number, sourceKey: string, timeoutMs = 20000, signal?: AbortSignal): Promise<SourceCatalogResult> {
    const text = await this.fetchText(api, timeoutMs, signal);
    const sortClasses = this.parseSort(text, type);
    const abs = this.parseBody(text, type, sourceKey);
    const movie = abs?.movie ?? null;
    const base: SourceCatalogResult = {
      sortClasses,
      items: movieToVodItems(movie, sourceKey),
      page: movie?.page ?? 0,
      pagecount: movie?.pagecount ?? 0,
      total: movie?.recordcount ?? 0,
    };
    if (base.items.length === 0 && sortClasses.length > 0) {
      try {
        const first = sortClasses[0];
        const fallback = await this.category(api, type, sourceKey, String(first.id), '1', {}, timeoutMs, signal);
        if (fallback.items.length > 0) {
          return { ...base, items: fallback.items, pagecount: fallback.pagecount || 1, total: fallback.total || fallback.items.length, homeFallback: true };
        }
      } catch {
        if (signal?.aborted) throw abortError(signal);
        // 回退失败不致命：保留分类结果，用户仍可点分类浏览
      }
    }
    return base;
  }

  /** 分类列表 */
  async category(
    api: string,
    type: number,
    sourceKey: string,
    tid: string,
    pg: string,
    extend: Record<string, string>,
    timeoutMs = 20000,
    signal?: AbortSignal,
  ): Promise<CmsResult> {
    const params: Record<string, string> = {
      ac: this.ac(type),
      t: tid,
      pg: pg,
    };
    const fKeys = Object.keys(extend);
    if (fKeys.length > 0) params['f'] = JSON.stringify(extend);
    const url = withQuery(api, params);
    const text = await this.fetchText(url, timeoutMs, signal);
    const abs = this.parseBody(text, type, sourceKey);
    const movie = abs?.movie ?? null;
    return {
      sortClasses: [],
      items: movieToVodItems(movie, sourceKey),
      page: movie?.page ?? 0,
      pagecount: movie?.pagecount ?? 0,
      total: movie?.recordcount ?? 0,
    };
  }

  /** 详情：GET api?ac=...&ids=ID */
  async detail(api: string, type: number, sourceKey: string, ids: string[], timeoutMs = 20000): Promise<VodDetail | null> {
    const url = withQuery(api, { ac: this.ac(type), ids: ids.join(',') });
    const text = await this.fetchText(url, timeoutMs);
    const abs = this.parseBody(text, type, sourceKey);
    return movieToVodDetail(abs?.movie ?? null);
  }

  /** 搜索：GET api?ac=...&wd=KW */
  async search(api: string, type: number, sourceKey: string, wd: string, timeoutMs = 20000, signal?: AbortSignal): Promise<VodItem[]> {
    const url = withQuery(api, { ac: this.ac(type), wd });
    const text = await this.fetchText(url, timeoutMs, signal);
    const abs = this.parseBody(text, type, sourceKey);
    return movieToVodItems(abs?.movie ?? null, sourceKey);
  }
}
