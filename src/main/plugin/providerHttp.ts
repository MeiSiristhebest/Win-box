// src/main/plugin/providerHttp.ts
// 声明式 provider（L2：`subtitle.provider` / `meta.provider` / 后续 `discover.source`…）的**共用小工具**。
//
// 为什么抽出来：这些 provider 全是「宿主代发请求 → 取 JSON → 按受限路径取数」的同一形态，
// 请求头展开 / 取值 / 解码 / 取文本的细节只应有一份实现（避免各 provider 各抄一遍而漂移）。
//
// ★ 依赖方向：本文件复用宿主**既有**的极简 HTTP 取字节工具（`subtitle/http`），**不新造网络栈**
//   （设计方案 §1「勿重造」）。解码口径见下方 `decodeBody`（**不复用**字幕文本的启发式）。
import * as iconv from 'iconv-lite';
import { getBuffer } from '../subtitle/http';

/**
 * 声明式 provider 的响应解码：**UTF-8 优先，非法才回落 GB18030**。
 * ★ 为什么不复用字幕的 `decodeSubtitle`（双解码打分选优）：那是为「字幕文本」设计的启发式，
 *   对**纯 UTF-8 的 JSON/XML API 响应**会因启发式打分把中文误判成 GBK（实测 JSON 里的「繁花」被解成「绻佽姳」）。
 *   JSON/API 响应按规范就是 UTF-8；GBK 源会因 UTF-8 严格解码失败而自然落到回落分支。
 */
function decodeBody(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return iconv.decode(buf, 'gb18030');
  }
}

/** 请求头里的占位符用**原值**替换（与 url 的 encodeURIComponent 不同：头值不该被百分号编码） */
export function expandRaw(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (raw, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] ?? '' : raw,
  );
}

/** 展开整个请求头表 */
export function headerSpec(h: Record<string, string> | undefined, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k] = expandRaw(v, vars);
  return out;
}

/** JSON 值 → 字符串（数字/布尔也接受；对象/数组视为空） */
export function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** 取文本（UTF-8 优先、非法回落 GB18030）；失败抛错（由调用方落到该源的报告/日志） */
export async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const buf = await getBuffer(url, { headers });
  if (!buf) throw new Error('请求失败或响应超限');
  return decodeBody(buf);
}

/** 取 JSON；非合法 JSON → 抛可读错误 */
export async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const text = await fetchText(url, headers);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('响应不是合法 JSON');
  }
}
