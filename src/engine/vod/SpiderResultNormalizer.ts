// Pure conversions from upstream Spider JSON into application playback/catalog models.
import type { VodItem, VodDetail, PlayResult } from '../../shared/types';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import { classFiltersFor, normalizeClassList, type SortClass } from '../parse/Movie';
import { parseEpisodes } from './VodNormalizer';
import { normalizeVodId, normalizeVodPic, splitUrlHeaders } from './itemNormalize';
import { fixDetailFields } from './detailFix';
import { SourceProblemError, SOURCE_PROBLEM_TEXT } from '../spider/errors';
import { directPlayUrlError } from '../../shared/playbackResult';
import type { HomeResult } from './SourcePorts';

export const PAGE_ITEMS_ONE_PAGE = 20;
const PAGE_COUNT_UNKNOWN = 9999;

export class SpiderResultNormalizer {
  // --- spider JSON 归一化（type3 返回的 JSON 结构 {list:[{vod_id,vod_name,vod_pic,vod_remarks}],...}） ---
  /**
   * 解析蜘蛛返回的 JSON（home/category/search 共用）。
   * 空串/纯空白 → null；非法 JSON → null；**均不抛**（是否报错交给调用方，便于首页回退）。
   */
  parseSpiderJson(
    json: string,
    key: string,
  ): { classes: SortClass[]; items: VodItem[]; page: number; pagecount: number; total: number } | null {
    if (!json || !json.trim()) return null;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(json) as Record<string, unknown>;
    } catch {
      return null;
    }
    // ★ 2026-10-16：`.py` 蜘蛛里 `homeVideoContent` 常写成 `pass`（Python 返回 `None`）→ 序列化成字面量
    //   `null`；此前直接 `o['class']` 会抛 `Cannot read properties of null (reading 'class')`
    //   （用户侧：homeVideoContent 回退失败 + 日志噪声）。按「非法 JSON → null（不抛）」同口径吞掉。
    if (!o || typeof o !== 'object') return null;
    // 分类 id 保留原样字符串（蜘蛛源存在非数字 id，Number 化会丢分类）；type_flag 透传供筛选联动。
    // ★ 2026-10-15：class 的形态兜底（对象 map 等非数组写法不再被整段丢弃）见 normalizeClassList；
    //   filters 的形态兜底（**顶层按 type_id 键控** 那一份不再被丢掉）见 classFiltersFor。
    const classes = normalizeClassList(o['class']).map((c, i) => {
      const id = String(c['type_id'] ?? c['id'] ?? c['tid'] ?? '').trim();
      const filters = classFiltersFor(o, c, id, i);
      return {
        id,
        name: String(c['type_name'] ?? c['name'] ?? c['title'] ?? '').trim(),
        flag: c['type_flag'] != null ? String(c['type_flag']) : undefined,
        // 仅当有筛选才带上 filters，保持无筛选源对象形状与历史一致
        ...(filters.length > 0 ? { filters } : {}),
      };
    });
    const list = Array.isArray(o['list']) ? (o['list'] as Record<string, unknown>[]) : [];
    // ★ 字段名多键兜底（对齐 normalizeSpiderDetail）：部分 py 源/蜘蛛返回 `name`/`pic` 而非
    //   vod_name/vod_pic —— 缺失会让列表 name 空 → 首页 TMDB 封面补全不触发 → 长期无封面。
    const items: VodItem[] = list.map((v) => {
      const rawPic = String(
        v['vod_pic'] ??
          v['pic'] ??
          v['vod_pic_url'] ??
          v['video_pic'] ??
          (Array.isArray(v['vod_pic_thumb']) ? v['vod_pic_thumb'][0] : '') ??
          '',
      );
      const name = String(v['vod_name'] ?? v['name'] ?? '');
      // ★ 2026-09-30（用户报「其他接口的盘搜类型源搜索结果看不了内容」）：
      //   透传源侧 vod_tag（`folder` = 文件夹条目）。渲染层据此走 categoryContent 展开
      //   而不是进详情页（详情必空）；存进 DTO 里也让 UI 能给文件夹卡加 📁 标识。
      const tag = String(v['vod_tag'] ?? '');
      return {
        // ★ 空 id → 片名兜底（片单类蜘蛛没有 vod_id；空串会让「按 id 记的坏图/补图/key」全塌到同一键）
        id: normalizeVodId(v['vod_id'] ?? v['id'], name),
        name,
        // ★ 拆上游 `@Referer=…` 尾巴（否则图床 404 → 全列表封面坏 → 补图串到所有卡片）
        pic: normalizeVodPic(rawPic),
        remarks: String(v['vod_remarks'] ?? v['remarks'] ?? ''),
        year: String(v['vod_year'] ?? v['year'] ?? ''),
        area: String(v['vod_area'] ?? v['area'] ?? ''),
        type: String(v['type_name'] ?? v['type'] ?? ''),
        sourceKey: key,
        ...(tag ? { tag } : {}),
      };
    });
    return {
      classes: classes.filter((c) => c.name && c.id), // 空 name 或空 id 均丢弃（空 id 无法发起分类请求）
      items,
      page: Number(o['page'] ?? 0),
      pagecount: Number(o['pagecount'] ?? 0),
      total: Number(o['total'] ?? 0),
    };
  }

  /**
   * category/search 用：委托 parseSpiderJson。emptyIsError 语义与错误文案保持不变。
   * 空串/非法 JSON → SPIDER_ERROR；解析成功但 class+list 均空 → EMPTY_RESULT。
   */
  normalizeSpiderJson(json: string, key: string, emptyIsError = false): HomeResult {
    const emptyResult = (): HomeResult => ({
      sortClasses: [],
      items: [],
      page: 0,
      pagecount: 0,
      total: 0,
      sourceKey: key,
    });
    const p = this.parseSpiderJson(json, key);
    if (!p) {
      if (!emptyIsError) return emptyResult();
      // 仅在 error 分支重解析一次，保留原有"非法 JSON"详情文案（正常路径无额外开销）
      if (json && json.trim()) {
        let err: unknown;
        try {
          JSON.parse(json);
        } catch (e) {
          err = e;
        }
        throw new SourceProblemError(
          'SPIDER_ERROR',
          `蜘蛛返回内容不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
      throw new SourceProblemError('SPIDER_ERROR', SOURCE_PROBLEM_TEXT.SPIDER_ERROR);
    }
    if (emptyIsError && p.classes.length === 0 && p.items.length === 0) {
      throw new SourceProblemError('EMPTY_RESULT', SOURCE_PROBLEM_TEXT.EMPTY_RESULT);
    }
    return {
      sortClasses: p.classes,
      items: p.items,
      page: p.page,
      pagecount: this.pagingFallback(p.pagecount, p.items.length),
      total: p.total,
      sourceKey: key,
    };
  }

  /**
   * ★ 2026-10-16：**分页元数据兜底**（只用于 type3 的 category —— 首页/搜索没有页码语义，见 §C78）。
   *   源没给总页数（`pagecount <= 1`）却回了「装得满一页」的列表 → 报 `PAGE_COUNT_UNKNOWN`，
   *   让 UI 放开「下一页 / 瀑布」；真的只有寥寥几条 → 保持原样（多半确实只有一页）。
   *   判据必须**同时**满足两条，避免把「真·单页源」也放开（放开后到底与否由 UI 的零新增护栏判定）。
   */
  private pagingFallback(pagecount: number, itemCount: number): number {
    if (!Number.isFinite(pagecount) || pagecount > 1) return pagecount;
    return itemCount >= PAGE_ITEMS_ONE_PAGE ? PAGE_COUNT_UNKNOWN : pagecount;
  }

  /**
   * 首页（type3）：对齐原版 SourceViewModel.java:230-290 的「homeContent → 回退 homeVideoContent」，
   * 并补齐与 CmsSource.home 同等的「分类兜底」（见下 ③），保证 csp_/jar 源主页不出现空网格。
   * ① homeContent 自带「装得满一页」的 list → 直接用，绝不触发回退；
   * ② list 为空/**装不满一页**（或 homeContent 非法）→ 回退 homeVideoContent 取推荐列表（失败/超时静默降级，不抛）；
   * ③ 仍不满一页但有分类 → 拉首个分类第 1 页当首页内容（与 CMS 路径一致，P0-JVM-HOME）；
   * ④ 兜底后仍全空 → EMPTY_RESULT（homeContent 合法）/ SPIDER_ERROR（空或非法）。
   * 注：sp.homeContent 自身抛错（.py / 无桥 jar 的 PY_UNSUPPORTED / JAR_NO_RUNTIME）必须原样上抛。
   *
   * ★ 2026-10-16（用户报「玩偶/木偶等源，点播分类选『全部』展示的内容也十分有限，一页都填不满」）：
   *   判据由「`list` 非空」放宽为「`list` **装得满一页**（≥ {@link PAGE_ITEMS_ONE_PAGE}）」——
   *   实测玩偶的 `homeContent` 只回 12 条（源侧本身就这么少，且有时抖动到 0/3 条），
   *   而它的首个分类第 1 页有 70 条 ⇒ 继续沿用既有「分类兜底」口径取到能填满的内容。
   *   ★ 任何兜底都**只取更丰富的那份**（回退结果条目数必须严格多于首页自带），不会把列表换小。
   */

  normalizeSpiderDetail(json: string): VodDetail | null {
    if (!json) return null;
    try {
      const o = JSON.parse(json) as Record<string, unknown>;
      const list = Array.isArray(o['list']) ? (o['list'] as Record<string, unknown>[]) : [];
      if (list.length === 0) return null;
      const v = list[0];
      const playFrom = String(v['vod_play_from'] ?? '');
      const playUrlStr = String(v['vod_play_url'] ?? '');
      const episodes: Record<string, { name: string; url: string }[]> = {};
      const flags: string[] = [];
      const flagsArr = playFrom.split('$$$');
      const urlsArr = playUrlStr.split('$$$');
      for (let i = 0; i < flagsArr.length && i < urlsArr.length; i++) {
        const f = flagsArr[i].trim();
        const eps = parseEpisodes(urlsArr[i]);
        if (f && eps.length) {
          episodes[f] = eps;
          flags.push(f);
        }
      }
      const detail: VodDetail = {
        // ★ 空 id → 片名兜底、封面拆 `@Referer=` 尾巴（同列表页归一，见 parseSpiderJson）
        id: normalizeVodId(v['vod_id'] ?? v['id'], v['vod_name'] ?? v['name']),
        name: String(v['vod_name'] ?? v['name'] ?? ''),
        pic: normalizeVodPic(
          String(
            v['vod_pic'] ??
              v['pic'] ??
              v['vod_pic_url'] ??
              v['video_pic'] ??
              (Array.isArray(v['vod_pic_thumb']) ? v['vod_pic_thumb'][0] : '') ??
              '',
          ),
        ), // ★ fty 等蜘蛛 detail 偶发把封面放在别名键，做兜底；列表页走同一归一（见 parseSpiderJson）
        type: String(v['type_name'] ?? ''),
        year: String(v['vod_year'] ?? ''),
        area: String(v['vod_area'] ?? ''),
        director: String(v['vod_director'] ?? ''),
        actor: String(v['vod_actor'] ?? ''),
        des: String(v['vod_content'] ?? ''),
        remarks: String(v['vod_remarks'] ?? ''),
        flags,
        episodes,
      };
      // ★ 2026-09-24：字段错位纠偏（如「立播」源把地区名塞进导演/演员、类型串塞进年份/地区）
      return fixDetailFields(detail);
    } catch {
      return null;
    }
  }

  normalizeSpiderSearch(json: string, key: string): VodItem[] {
    return this.normalizeSpiderJson(json, key, false).items;
  }

  /**
   * P1-2：type3 播放结果归一化（对齐原版 Result.playContent 语义）。
   * - header/headers 备用键（蜘蛛两种拼写都常见），值统一 String 化；
   * - url 为数组（蜘蛛一次返回多段）→ 逐项归一后 # 连接，强制 parse=0 直连；
   * - video:// 前缀 → 去前缀；parse 未显式声明时才由前缀推断 parse=1（显式声明优先）；
   * - proxy://do=live... → 本地代理路由（与安卓同端口同路由）；其它 do= 原样保留 + parse=0 + 提示；
   * - jx 字段原样透传（生态里可能是 0/1，也可能是解析站 URL）；
   * - 非法 JSON / 空串 → parse=0、url=''（不抛，交给 UI 兜底）。
   */
  normalizeSpiderPlay(json: string, flag: string, playUrl: string): PlayResult {
    const empty: PlayResult = { parse: 0, url: '', playUrl, flag };
    if (!json || !json.trim()) return empty;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return empty;
    }
    // 数组形态：整体是 url 列表（["u1","u2"]），或 url 字段本身为数组 → # 连接直连
    const rec = parsed as Record<string, unknown> | null;
    const arr: unknown[] | null = Array.isArray(parsed)
      ? (parsed as unknown[])
      : Array.isArray(rec?.['url'])
        ? (rec['url'] as unknown[])
        : null;
    if (arr) {
      const resolvedArr = arr.map((u) => this.resolvePlayUrl(String(u ?? ''), undefined));
      /**
       * ★ 2026-10-16（用户报「这种 PY 直播源无法观看」）：
       *   TVBox 生态里 `playerContent` 的 `url` 数组**两种写法都有** ——
       *     ① 纯地址列表 `["https://a","https://b"]`；
       *     ② **「名称 / 地址」交替对** `["蓝光4M","https://a","超清","https://b"]`（虎牙/斗鱼/网易/B站
       *        多线路均用这种形态，名称只是给播放器做「清晰度菜单」用）。
       *   此前把**每一个**元素都当地址 → 拼成 `蓝光4M#https://a…`，交给播放器前会被
       *   `directPlayUrlError` 判为「返回了选集参数或相对路径」而**清空地址** ⇒ 一律黑屏。
       *   这里只保留**能归一成真实可播地址**的项，再按既有「# 连接多段」口径拼（首段即播放器实际
       *   使用的那条；判据与 `shared/playbackResult.directPlayUrlError` 同源，避免两套口径漂移）。
       *   全部项都不是地址（如斗鱼取链失败时的 `["原画","#-1"]`）→ 退回原行为，让上层给出「未取得
       *   播放地址」的明确提示，而不是拼出一条更离谱的地址。
       */
      const playable = resolvedArr.filter((r) => directPlayUrlError(r.url) === '');
      const picked = playable.length > 0 ? playable : resolvedArr;
      // ★ 数组分支此前**丢掉了**对象里的显式 `header/headers`（虎牙/斗鱼的播放头 UA/Referer 全靠它，
      //   丢了会让 CDN 按来源拒绝）—— 与对象分支同口径合并：地址尾巴拆出的头 < 显式 header。
      const arrHdr = {
        ...picked.find((r) => r.header)?.header,
        ...this.normalizePlayHeader(rec?.['header'] ?? rec?.['headers']),
      };
      return {
        parse: 0,
        url: picked.map((r) => r.url).join('#'),
        playUrl,
        flag,
        ...(Object.keys(arrHdr).length ? { header: arrHdr } : {}),
      };
    }
    const o = (rec ?? {}) as Record<string, unknown>;
    // parse 显式声明才生效（空串/缺失均视为未声明，交由 url 前缀语义推断）
    const declared =
      o['parse'] === undefined || o['parse'] === null || o['parse'] === ''
        ? undefined
        : Number(o['parse']) || 0;
    const resolved = this.resolvePlayUrl(String(o['url'] ?? ''), declared);
    // ★ 蜘蛛显式 header 优先，其次才是地址尾巴 `@Referer=…` 拆出来的头
    const hdr = { ...resolved.header, ...this.normalizePlayHeader(o['header'] ?? o['headers']) };
    return {
      parse: resolved.parse,
      url: resolved.url,
      playUrl,
      flag,
      ...(Object.keys(hdr).length ? { header: hdr } : {}),
      message: [String(o['msg'] ?? ''), resolved.hint].filter(Boolean).join('；') || undefined,
      jx:
        o['jx'] === undefined || o['jx'] === null || o['jx'] === ''
          ? undefined
          : (o['jx'] as number | string),
    };
  }

  /**
   * 单个播放 url 的归一：`@Referer=…` 约定尾巴 + video:// / proxy:// 前缀语义。
   * declaredParse 为蜘蛛显式 parse 声明（undefined = 未声明，由前缀推断）。
   */
  private resolvePlayUrl(
    raw: string,
    declaredParse: number | undefined,
  ): { url: string; parse: number; hint?: string; header?: Record<string, string> } {
    // ★ 上游约定：`url@Referer=…@User-Agent=…` → 拆出真实地址 + 取流所需请求头
    //   （头由 SpiderHost 经 /play 中继注入；不拆则整串当地址 → 取流必失败）
    const split = splitUrlHeaders(raw);
    const url = split.url;
    const header = Object.keys(split.headers).length
      ? {
          ...(split.headers.referer ? { Referer: split.headers.referer } : {}),
          ...(split.headers['user-agent'] ? { 'User-Agent': split.headers['user-agent'] } : {}),
          ...(split.headers.cookie ? { Cookie: split.headers.cookie } : {}),
        }
      : undefined;
    if (url.startsWith('video://')) {
      // Explicit HTML pages always need sniffing; preserve declared parse for stream URLs.
      const page = url.slice('video://'.length);
      return { url: page, parse: /\.html?(?:[?#]|$)/i.test(page) ? 1 : declaredParse ?? 1, header };
    }
    if (url.startsWith('proxy://')) {
      const rest = url.slice('proxy://'.length);
      if (rest.startsWith('do=live')) {
        // 本地直播/代理资源 → 本地代理 HTTP 路由（与安卓同端口同路由 do=live）
        return { url: `${LOCAL_PROXY_BASE}/proxy?${rest}`, parse: declaredParse ?? 0, header };
      }
      // 其它 do= 路由桌面版本地代理不识别 → 原样保留 + parse=0 + message 提示
      return { url, parse: 0, hint: '该源需要蜘蛛本地代理路由（桌面版未实现）', header };
    }
    return { url, parse: declaredParse ?? 0, header };
  }

  /** header/headers 备用键 → 值统一 String 化；对象与 JSON 字符串两形态都收，其余丢弃 */
  private normalizePlayHeader(raw: unknown): Record<string, string> | undefined {
    let o: unknown = raw;
    if (typeof o === 'string') {
      try {
        o = JSON.parse(o);
      } catch {
        return undefined;
      }
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) out[k] = String(v);
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
