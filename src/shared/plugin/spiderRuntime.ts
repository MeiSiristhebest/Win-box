import { ID_RE, type ValidateResult } from './core';

/** The Spider methods a trusted code plugin may implement. */
export const SPIDER_RUNTIME_OPERATIONS = [
  'homeContent',
  'homeVideoContent',
  'categoryContent',
  'detailContent',
  'searchContent',
  'searchContentPage',
  'playerContent',
  'liveContent',
] as const;

export type SpiderRuntimeOperation = (typeof SPIDER_RUNTIME_OPERATIONS)[number];

/** Manifest descriptor for one source protocol implemented by a code plugin. */
export interface SpiderRuntimeContribute {
  type: 'spider.runtime';
  id: string;
  label: string;
  /** Literal prefix matched against SourceBean.api. No regular expressions are evaluated. */
  apiPrefix: string;
  operations: SpiderRuntimeOperation[];
}

const FIELDS = ['type', 'id', 'label', 'apiPrefix', 'operations'] as const;

export function validateSpiderRuntimeContribute(value: unknown): ValidateResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reasonCode: 'SPIDER_RUNTIME_INVALID', reason: 'spider.runtime 贡献项非法' };
  }
  const item = value as Record<string, unknown>;
  for (const field of Object.keys(item)) {
    if (!(FIELDS as readonly string[]).includes(field)) {
      return { ok: false, reasonCode: 'SPIDER_RUNTIME_INVALID', reason: `spider.runtime 字段未知：${field}` };
    }
  }
  if (item.type !== 'spider.runtime' || typeof item.id !== 'string' || !ID_RE.test(item.id)) {
    return { ok: false, reasonCode: 'SPIDER_RUNTIME_INVALID', reason: 'spider.runtime.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof item.label !== 'string' || !item.label.trim() || item.label.trim().length > 60 || /[\r\n]/.test(item.label)) {
    return { ok: false, reasonCode: 'SPIDER_RUNTIME_INVALID', reason: 'spider.runtime.label 必填（1~60 字，不含换行）' };
  }
  if (typeof item.apiPrefix !== 'string' || !item.apiPrefix.trim() || item.apiPrefix.length > 512 || /\s/.test(item.apiPrefix) || [...item.apiPrefix].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    return { ok: false, reasonCode: 'SPIDER_RUNTIME_INVALID', reason: 'spider.runtime.apiPrefix 必须是 1~512 字的无空白文本前缀' };
  }
  if (!Array.isArray(item.operations) || item.operations.length === 0 || item.operations.length > SPIDER_RUNTIME_OPERATIONS.length) {
    return { ok: false, reasonCode: 'SPIDER_RUNTIME_INVALID', reason: 'spider.runtime.operations 必须至少声明一种受支持操作' };
  }
  const seen = new Set<string>();
  for (const operation of item.operations) {
    if (typeof operation !== 'string' || !(SPIDER_RUNTIME_OPERATIONS as readonly string[]).includes(operation) || seen.has(operation)) {
      return { ok: false, reasonCode: 'SPIDER_RUNTIME_INVALID', reason: `spider.runtime.operations 含未知或重复操作：${String(operation)}` };
    }
    seen.add(operation);
  }
  return { ok: true };
}

/** Copy a value across the worker boundary as bounded, JSON-only data. */
export function boundedJsonClone(value: unknown, maxBytes: number): unknown {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new Error(`蜘蛛插件消息不是可序列化 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof encoded !== 'string') throw new Error('蜘蛛插件消息必须是 JSON 值');
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new Error(`蜘蛛插件消息超过大小限制（${maxBytes} 字节）`);
  }
  return JSON.parse(encoded) as unknown;
}
