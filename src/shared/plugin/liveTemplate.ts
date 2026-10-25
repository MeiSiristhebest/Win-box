import { ID_RE, type ValidateResult } from './core';
import { placeholdersOf } from './providerSchema';

// ---------- ★ 直播输出模板契约（`contributes.live.template`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.8。**L2 声明式**，但与前四者**形态不同**：
//   ★ 本类型**不发网络请求、不取数** —— 它把宿主**已解析**的直播频道（`LiveGroup[]`）**格式化输出**成文本
//     （TXT / M3U），供外部播放器 / 其它设备使用。插件只给「每行格式串」，宿主负责取数与写盘。
//   ★ 绝**不解析**任何直播订阅格式（红线③：不触碰 TxtSubscribe / LiveConfigParser —— 那是引擎解析行为）。
//   ★ 同理 `kind:"asset"`、`permissions` 恒空、不得有 `main`。

/** 输出行模板（仅格式化宿主**已解析**的直播频道；不取数、不解析、不发请求） */
export interface LiveTemplateContribute {
  type: 'live.template';
  /** 稳定 id（导出面板里的模板键；同插件内唯一） */
  id: string;
  /** 显示名（导出面板里的选项名） */
  label: string;
  /** 输出类型：决定语义与**默认扩展名**（txt = TVBox 惯用文本；m3u = 播放列表） */
  format: 'txt' | 'm3u';
  /** 分组行模板（可选）。txt 惯用 `{group},#genre#`；**不得含 `{url}`**、须是单行 */
  group?: string;
  /** 文件头（可选，**逐行**；m3u 惯用 `["#EXTM3U"]`）；每项须是单行 */
  header?: string[];
  /** 频道行模板（**必须含 `{url}`**；允许含 `\n` 表达多行，如 m3u 的 `#EXTINF…\n{url}`） */
  line: string;
  /** 扩展名（可选，不带点；`[a-z0-9]{1,8}`）；缺省 txt→`txt` / m3u→`m3u` */
  ext?: string;
}

/** 模板占位符白名单（分组行与频道行共用；渲染时由宿主从 LiveGroup 展开） */
export const LIVE_TEMPLATE_PLACEHOLDERS: readonly string[] = [
  'group', 'name', 'url', 'logo', 'tvgId', 'tvgName', 'tvgChno', 'index',
];
/** 输出类型白名单 */
export const LIVE_TEMPLATE_FORMATS: readonly string[] = ['txt', 'm3u'];

/** 各类型的默认扩展名 */
export function liveTemplateExt(format: 'txt' | 'm3u'): string {
  return format === 'm3u' ? 'm3u' : 'txt';
}

/** 导出文本的行连接符（Windows 友好，且既有 TxtSubscribe 解析兼容） */
export const LIVE_TEMPLATE_EOL = '\r\n';

const LIVE_TEMPLATE_FIELDS: readonly string[] = ['type', 'id', 'label', 'format', 'group', 'header', 'line', 'ext'];
const LIVE_EXT_RE = /^[a-z0-9]{1,8}$/;

/** 模板片段里的未知占位符检查（返回描述；undefined = 合法） */
function templatePlaceholderError(s: string, where: string): string | undefined {
  for (const name of placeholdersOf(s)) {
    if (!LIVE_TEMPLATE_PLACEHOLDERS.includes(name)) {
      return `${where} 含未知占位符 {${name}}（允许 ${LIVE_TEMPLATE_PLACEHOLDERS.join(' / ')}）`;
    }
  }
  return undefined;
}

/**
 * 行模板校验（换行 / 空行 / 占位符 / 必含项）。
 * ★ 原因码按**成因**分：占位符越界 → `LIVE_TEMPLATE_INVALID`；结构性（空/空行/换行/缺 `{url}`）→ `opts.lineCode`。
 * @param opts.allowNewline 是否允许 `\n`（频道行允许，分组行与文件头不允许）
 * @param opts.requireUrl 是否必须含 `{url}`（频道行必须）
 * @param opts.lineCode 结构性问题的原因码（频道行 = `BAD_LIVE_TEMPLATE_LINE`；分组行 / 文件头 = `LIVE_TEMPLATE_INVALID`）
 */
function templateTextIssue(
  s: unknown,
  where: string,
  opts: { allowNewline: boolean; requireUrl: boolean; lineCode: 'BAD_LIVE_TEMPLATE_LINE' | 'LIVE_TEMPLATE_INVALID' },
): ValidateResult | undefined {
  if (typeof s !== 'string' || !s.trim()) return { ok: false, reasonCode: opts.lineCode, reason: `${where} 必填（非空字符串）` };
  const pe = templatePlaceholderError(s, where);
  if (pe) return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: pe };
  if (/\r/.test(s)) return { ok: false, reasonCode: opts.lineCode, reason: `${where} 不得含回车（\\r）` };
  if (!opts.allowNewline && /\n/.test(s)) return { ok: false, reasonCode: opts.lineCode, reason: `${where} 不得含换行` };
  if (s.split('\n').some((x) => !x.trim())) return { ok: false, reasonCode: opts.lineCode, reason: `${where} 不得含空行` };
  if (opts.requireUrl && !placeholdersOf(s).includes('url')) {
    return { ok: false, reasonCode: opts.lineCode, reason: `${where} 必须含占位符 {url}` };
  }
  return undefined;
}

/** 校验 `contributes.live.template`（纯函数） */
export function validateLiveTemplateContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim()) {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.label 必填' };
  }
  if (t.format !== 'txt' && t.format !== 'm3u') {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.format 须为 txt | m3u' };
  }
  for (const k of Object.keys(t)) {
    if (!LIVE_TEMPLATE_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: `live.template 字段未知：${k}` };
    }
  }
  const le = templateTextIssue(t.line, 'live.template.line', { allowNewline: true, requireUrl: true, lineCode: 'BAD_LIVE_TEMPLATE_LINE' });
  if (le) return le;
  if (t.group != null) {
    const ge = templateTextIssue(t.group, 'live.template.group', { allowNewline: false, requireUrl: false, lineCode: 'LIVE_TEMPLATE_INVALID' });
    if (ge) return ge;
    if (placeholdersOf(String(t.group)).includes('url')) {
      return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.group 不得含占位符 {url}' };
    }
  }
  if (t.header != null) {
    if (!Array.isArray(t.header) || !t.header.length) {
      return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.header 须是非空数组' };
    }
    for (let i = 0; i < t.header.length; i++) {
      const he = templateTextIssue(t.header[i], `live.template.header[${i}]`, {
        allowNewline: false, requireUrl: false, lineCode: 'LIVE_TEMPLATE_INVALID',
      });
      if (he) return he;
    }
  }
  if (t.ext != null && (typeof t.ext !== 'string' || !LIVE_EXT_RE.test(t.ext))) {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.ext 须匹配 [a-z0-9]{1,8}（不带点）' };
  }
  return { ok: true };
}
