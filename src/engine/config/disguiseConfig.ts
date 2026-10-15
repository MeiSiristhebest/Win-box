// src/engine/config/disguiseConfig.ts
// ★ 2026-10-15：订阅「**伪装体**」提取 —— 用户报 `https://yc.wya6.cn/wykj.php` 无法被正确识别。
//
// 实测形态（该站**按 UA 分流**：浏览器 / `TVBox` / `catvod` UA 都给「浮光」落地页 HTML(≈2.5KB)，
//   只有 `okhttp/*` UA 才给真体）：
//   真体 121,625B / 476 行：
//     · 前 475 行 = 一个 jar 的**十六进制 dump**（每行 `16 字节 hex | ASCII`，首 4 字节 50 4B 03 04 = PK）；
//     · 最后一行仍是同样的 dump 形态，但 **ASCII 列**里带着分隔标记 **`=WUYIwuyi**`**，
//       标记之后就是 **base64(完整订阅 JSON)**（89,664 字符 → 65,401B；含 spider / sites×158 / lives×9 …）。
//   ⇒ 伪装阶梯每一档都判否（体被嗅探成纯文本）、图片尾部隐写不适用、`decodeLocalCipher`
//     把 dump 文本与 base64 拼成一段再当 hex/base64 解也解不出 —— 于是只剩第三方 `jiemi.php` 兜底。
//
// 本模块只做「把真配置从伪装文本里捞出来」这一件事（纯函数，便于单测）。
// 接入点：`SpiderHost.fetchConfigText` —— **图片隐写之后、解密兜底之前**（本地可解释手段优先于第三方）。
import { looksLikeSubscribeJson } from './ApiConfigParser';

/** 通用兜底：全文里「最长的一段 base64」达到该长度才认为是载荷（避免把短串解成垃圾） */
const MIN_FALLBACK_RUN = 1024;

export interface DisguiseResult {
  /** 捞出来的订阅 JSON 文本 */
  text: string;
  /** 命中的分隔标记（走通用兜底时为 ''） */
  marker: string;
  /** 载荷起点：marker 路径 = 原文下标；兜底路径 = 原文中首次出现该段的位置（找不到为 -1） */
  offset: number;
  /** 走的是哪条路（写日志/诊断用） */
  how: 'marker' | 'longest-base64';
}

/** 严格解一段 base64：先去空白、再要求整段都在 base64 字母表内；解出来不是订阅 JSON 则返回 null */
function decodeB64Run(run: string, minLen: number): string | null {
  const s = run.replace(/\s+/g, '');
  if (s.length < minLen || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try {
    const out = Buffer.from(s, 'base64').toString('utf-8');
    return looksLikeSubscribeJson(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * 从「伪装体」文本里提取订阅 JSON。
 * 顺序：① **最后出现的** `=XXX**` 标记之后的 base64（该站口径；取最后一个 —— 前面那些是 dump ASCII 列的噪声）；
 *      ② 通用兜底：全文里最长的 base64 连续段（去掉空白后按非 base64 字符切分）。
 * 两条路都拿不到合法订阅 JSON → 返回 null（调用方继续走解密兜底）。
 */
export function extractDisguiseConfig(raw: string): DisguiseResult | null {
  const text = raw || '';
  if (!text) return null;
  // 已经是正常订阅 JSON 的话不归本模块管（伪装阶梯那一档就该命中）
  if (looksLikeSubscribeJson(text)) return null;

  // ① 标记路径
  const re = /=[A-Za-z0-9]{4,32}\*\*/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(text)) !== null) last = m;
  if (last) {
    const marker = last[0];
    const start = last.index + marker.length;
    // 标记是很强的信号 → 门槛放低（小配置也要能解）
    const hit = decodeB64Run(text.slice(start), 64);
    if (hit) return { text: hit, marker, offset: start, how: 'marker' };
  }

  // ② 通用兜底：最长 base64 连续段
  const compact = text.replace(/\s+/g, '');
  const runs = compact
    .split(/[^A-Za-z0-9+/=]+/)
    .filter((r) => r.length >= MIN_FALLBACK_RUN)
    .sort((a, b) => b.length - a.length);
  for (const r of runs.slice(0, 4)) {
    const hit = decodeB64Run(r, MIN_FALLBACK_RUN);
    if (hit) {
      const at = text.indexOf(r.slice(0, 16));
      return { text: hit, marker: '', offset: at, how: 'longest-base64' };
    }
  }
  return null;
}
