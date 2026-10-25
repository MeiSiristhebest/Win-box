/** Shared schema primitives for declarative HTTP based plugin providers. */
export interface ProviderHttpSpec {
  url: string;
  headers?: Record<string, string>;
}

export const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;
const HEADER_KEY_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const FORBIDDEN_HEADER_KEYS: readonly string[] = ['host', 'content-length', 'connection', 'transfer-encoding'];
const PATH_SEG_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\[\d{1,3}\])?$/;

/** Template variable names, unique and in source order. */
export function placeholdersOf(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_RE)) if (!out.includes(match[1])) out.push(match[1]);
  return out;
}

/** Restricted JSON path syntax: `name` or `name[0]` per dot-delimited segment. */
export function isProviderPath(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  return !!path && path.split('.').every((segment) => PATH_SEG_RE.test(segment));
}

export function providerUrlError(value: unknown, allowedPlaceholders: readonly string[]): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return 'url 必填';
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) return 'url 只允许 http:// 或 https://';
  if (/[\s\r\n]/.test(url.replace(PLACEHOLDER_RE, ''))) return 'url 不得含空白或换行';
  for (const name of placeholdersOf(url)) {
    if (!allowedPlaceholders.includes(name)) return `url 含未知占位符 {${name}}（本处允许 ${allowedPlaceholders.join(' / ')}）`;
  }
  return undefined;
}

export function providerHeadersError(headers: unknown, allowedPlaceholders: readonly string[]): string | undefined {
  if (headers == null) return undefined;
  if (typeof headers !== 'object' || Array.isArray(headers)) return 'headers 必须是对象';
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (!HEADER_KEY_RE.test(key)) return `请求头键非法：${key}`;
    if (FORBIDDEN_HEADER_KEYS.includes(key.toLowerCase())) return `请求头被禁用：${key}`;
    if (typeof value !== 'string' || /[\r\n]/.test(value)) return `请求头值非法：${key}`;
    for (const name of placeholdersOf(value)) {
      if (!allowedPlaceholders.includes(name)) return `请求头 ${key} 含未知占位符 {${name}}`;
    }
  }
  return undefined;
}
