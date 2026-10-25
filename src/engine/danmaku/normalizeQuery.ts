// src/engine/danmaku/normalizeQuery.ts
// 弹幕搜索前把资源名清洗成多个候选，提高 search/anime（作品名搜番剧）命中率。
// 背景：很多资源名为了规避审核被改得"奇奇怪怪"（夹符号/emoji、错字谐音、删字、
//      带"第N集/更新至N"尾缀等），直接拿原名搜索往往匹配不到；
//     这里的清洗 + 多候选让搜索至少能贴近常见写法。
function full2half(s: string): string {
  return s
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

function segment(s: string): string {
  return s
    .split(/[-/~/·:：|_]/)
    .map((p) => p.trim())
    .filter(Boolean)[0] ?? s;
}

/** 生成搜索候选词（去重、按原意优先，最长优先在前；最多 6 个） */
export function danmakuQueryCandidates(raw: string): string[] {
  if (!raw) return [];
  const base = full2half(raw).trim();
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim();
    if (v && v.length >= 2 && !seen.has(v)) { seen.add(v); out.push(v); }
  };
  // 1) 原文（半角化）
  push(base);
  // 2) 去尾部剧集标记：第N集/话/期/章、全N集、更新至N
  const noEp = base
    .replace(/\s*(?:第)?\d+[集话期章]\s*$/, '')
    .replace(/\s*全\d+[集话]\s*$/, '')
    .replace(/\s*更新至\s*\d+\s*$/, '')
    .trim();
  push(noEp);
  // 3) 去掉所有符号/空格/emoji，只留文字数字（应对"夹特效字符/火星文符号"）
  const pureBase = base.replace(/[^\p{L}\p{N}]+/gu, '');
  const pureNoEp = noEp.replace(/[^\p{L}\p{N}]+/gu, '');
  push(pureNoEp);
  push(pureBase);
  // 4) 取第一段（拆掉 " - " 字幕组后缀 / 季数等）
  push(segment(noEp));
  push(segment(base));
  return out.slice(0, 6);
}

// ---- ★ 2026-09-27（用户要求）：弹幕面板把「剧名 / 集」拆成两个独立输入框 ----
//   资源名里的集号五花八门（S01E10 / 第10集 / 10 / 更新至10），用户手动改写时也需要
//   同等的宽容度；下面两个函数负责「回填初值」与「解析用户输入」两个方向。
export interface EpisodeInput {
  /** 季号（`S02E01` / `第2季` → 2） */
  season?: number;
  /** 集号（已去前导零：`01` → `1`） */
  ep?: string;
}

/** 集号去前导零（`01`→`1`）；全零保留 `0` 以免变成空串 */
function stripEp(v: string): string {
  return v.replace(/^0+/, '') || '0';
}

/**
 * 解析「集」输入框内容（用户可手改）——常见写法都要认：
 *   `S01E10` / `s1e10` / `1x10` → 季 + 集；`E10` / `EP10` → 集；
 *   `第10集` / `第10话` / `第10期` → 集；纯数字 `10` → 集；`更新至10` / `至10` → 集；
 *   季号也可单独给：`第2季` / `S2` / `Season 2`。
 * 认不出来返回 `{}`（调用方回退「从资源名提取」）。
 */
export function parseEpisodeInput(raw: string): EpisodeInput {
  const s = full2half(raw || '').trim();
  if (!s) return {};
  const se = /[Ss](\d{1,2})\s*[Ee][Pp]?\s*(\d{1,4})/.exec(s) ?? /(\d{1,3})\s*[xX]\s*(\d{1,4})/.exec(s);
  if (se) return { season: Number(se[1]), ep: stripEp(se[2]) };
  const out: EpisodeInput = {};
  const sn = /第\s*(\d{1,3})\s*[季部]/.exec(s) ?? /(?:^|\b)s(?:eason)?\s*(\d{1,2})(?![0-9])/i.exec(s);
  if (sn) out.season = Number(sn[1]);
  const ep =
    /[Ee][Pp]?\s*(\d{1,4})/.exec(s) ??
    /第\s*(\d{1,4})\s*[集话期]/.exec(s) ??
    /(?:更新至|至)\s*(\d{1,4})/.exec(s) ??
    /^\s*(\d{1,4})\s*$/.exec(s);
  if (ep) out.ep = stripEp(ep[1]);
  return out;
}

/** 「集」输入框初值（由资源名生成）：`S01E10` → `S1E10`；`第10集`/末尾数字 → `10`；提不到 → `''` */
export function episodeFieldFromName(name: string): string {
  const s = (name || '').trim();
  if (!s) return '';
  const se = /[Ss](\d{1,2})\s*[Ee](\d{1,4})/.exec(s);
  if (se) return `S${Number(se[1])}E${stripEp(se[2]).padStart(2, '0')}`;
  const cn = /第\s*(\d{1,4})\s*[集话期]/.exec(s);
  if (cn) return stripEp(cn[1]);
  const e = /[Ee][Pp]?\s*(\d{1,4})(?![0-9])/.exec(s);
  if (e) return stripEp(e[1]);
  const tail = /(?<![0-9A-Za-z])(\d{1,3})(?![0-9])/.exec(s);
  return tail ? stripEp(tail[1]) : '';
}
