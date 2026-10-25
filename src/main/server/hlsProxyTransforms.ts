import { validateHeaderValue } from 'node:http';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import { isHlsPlaylistUrl } from '../../shared/playbackResult';

type HlsResourceKind = 'playlist' | 'asset';
const URI_ATTR_TAGS = /^#EXT-X-(?:KEY|SESSION-KEY|MAP|MEDIA|I-FRAME-STREAM-INF|PART|PRELOAD-HINT|RENDITION-REPORT)\b/i;

/** Resolve a relative/absolute HTTP URI unless it already points to this local relay. */
function absolutize(raw: string, baseUrl: string, proxyBase = LOCAL_PROXY_BASE): string {
  const value = (raw || '').trim();
  if (!value) return '';
  try {
    const absolute = new URL(value, baseUrl);
    if (!/^https?:$/.test(absolute.protocol) || absolute.origin === new URL(proxyBase).origin) return '';
    return absolute.toString();
  } catch {
    return '';
  }
}

/** Rewrite an HLS manifest using legacy UA/Referer/Cookie arguments. */
export function rewriteM3u8(body: Buffer, baseUrl: string, ua: string, referer: string, cookie: string): Buffer {
  return rewriteM3u8WithHeaders(body, baseUrl, {
    ...(ua ? { 'User-Agent': ua } : {}),
    ...(referer ? { Referer: referer } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  });
}

/** Decode only the named CatVod protocol; opaque URLs of other handlers stay in their JVM. */
export function hlsProxyTarget(url: URL): string {
  const value = url.searchParams.get('url') || '';
  if (url.searchParams.get('do') !== 'Adm3u8') return value;
  const encoded = value.replace(/ /g, '+');
  return /^[A-Za-z0-9_+/=-]+$/.test(encoded) ? Buffer.from(encoded, 'base64').toString('utf8') : '';
}

/** Rewrite an HLS manifest and carry safe upstream headers to each relayed resource. */
export function rewriteM3u8WithHeaders(body: Buffer, baseUrl: string, headers: Record<string, string>, proxyBase = LOCAL_PROXY_BASE): Buffer {
  const lines = body.toString('utf-8').split(/\r?\n/);
  const output: string[] = [];
  let nextUriIsPlaylist = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { output.push(line); continue; }
    if (trimmed.startsWith('#')) {
      const resourceKind: HlsResourceKind = /^#EXT-X-(?:KEY|SESSION-KEY|MAP|PART|PRELOAD-HINT)\b/i.test(trimmed) ? 'asset' : 'playlist';
      output.push(URI_ATTR_TAGS.test(trimmed) && /URI="/i.test(trimmed)
        ? rewriteUriAttrsWithHeaders(line, baseUrl, headers, proxyBase, resourceKind)
        : line);
      if (/^#EXT-X-STREAM-INF\b/i.test(trimmed)) nextUriIsPlaylist = true;
      continue;
    }
    const absolute = absolutize(trimmed, baseUrl, proxyBase);
    if (!absolute) { output.push(line); nextUriIsPlaylist = false; continue; }
    output.push(wrapSegmentWithHeaders(absolute, headers, proxyBase, nextUriIsPlaylist ? 'playlist' : 'asset'));
    nextUriIsPlaylist = false;
  }
  return Buffer.from(output.join('\n'), 'utf-8');
}

/** Rewrite URI attributes in an HLS tag using legacy UA/Referer/Cookie arguments. */
export function rewriteUriAttrs(line: string, baseUrl: string, ua: string, referer: string, cookie: string): string {
  return rewriteUriAttrsWithHeaders(line, baseUrl, {
    ...(ua ? { 'User-Agent': ua } : {}),
    ...(referer ? { Referer: referer } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  });
}

function rewriteUriAttrsWithHeaders(line: string, baseUrl: string, headers: Record<string, string>, proxyBase = LOCAL_PROXY_BASE, kind: HlsResourceKind = 'asset'): string {
  return line.replace(/URI="([^"]*)"/gi, (whole, uri: string) => {
    const absolute = absolutize(uri, baseUrl, proxyBase);
    if (!absolute) return whole;
    let hasFileExtension = false;
    try { hasFileExtension = /\.[a-z0-9]{1,10}$/i.test(new URL(absolute).pathname.split('/').pop() || ''); } catch { /* already validated */ }
    const resourceKind: HlsResourceKind = kind === 'asset' || (hasFileExtension && !isHlsPlaylistUrl(absolute)) ? 'asset' : 'playlist';
    return `URI="${wrapSegmentWithHeaders(absolute, headers, proxyBase, resourceKind)}"`;
  });
}

function wrapSegmentWithHeaders(url: string, headers: Record<string, string>, proxyBase: string, kind: HlsResourceKind): string {
  const params = new URLSearchParams({ url });
  params.set('hlsResource', kind);
  const normalized = safeProxyRequestHeaders(headers);
  const ua = headerValue(normalized, 'user-agent');
  const referer = headerValue(normalized, 'referer');
  const cookie = headerValue(normalized, 'cookie');
  if (ua) params.set('ua', ua);
  if (referer) params.set('referer', referer);
  if (cookie) params.set('cookie', cookie);
  const extra = Object.fromEntries(Object.entries(normalized).filter(([name]) =>
    !/^(user-agent|referer|cookie|range)$/i.test(name),
  ));
  if (Object.keys(extra).length) params.set('headers', encodeProxyHeaders(extra));
  let imageSegment = false;
  try { imageSegment = /\.(?:webp|jpe?g|png)$/i.test(new URL(url).pathname); } catch { /* invalid upstream */ }
  const query = imageSegment ? params.toString().replace(/\./g, '%2E') : params.toString();
  return `${proxyBase}${imageSegment ? '/play/segment.ts' : '/play'}?${query}`;
}

/** Read a request header without case sensitivity. */
export function headerValue(headers: Record<string, string>, name: string): string {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return '';
}

/** Keep only safe end-to-end request headers before forwarding to an upstream host. */
export function safeProxyRequestHeaders(input: Record<string, unknown>): Record<string, string> {
  const blocked = /^(host|connection|proxy-connection|keep-alive|te|trailer|upgrade|transfer-encoding|content-length|accept-encoding|range)$/i;
  const output = new Map<string, [string, string]>();
  const canonical: Record<string, string> = {
    'user-agent': 'User-Agent', ua: 'User-Agent', referer: 'Referer', cookie: 'Cookie',
    authorization: 'Authorization', origin: 'Origin',
  };
  for (const [name, raw] of Object.entries(input)) {
    if (!name || blocked.test(name) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) continue;
    try {
      validateHeaderValue(name, value);
      const key = canonical[name.toLowerCase()] || name;
      output.set(key.toLowerCase(), [key, value]);
    } catch { /* Drop invalid headers without failing playback. */ }
  }
  return Object.fromEntries(output.values());
}

function encodeProxyHeaders(headers: Record<string, string>): string {
  return Buffer.from(JSON.stringify(headers), 'utf8').toString('base64url');
}

/** Decode TVBox form-encoded Base64 headers and internal Base64/JSON headers. */
export function decodeProxyHeaders(value: string): Record<string, string> | null {
  if (!value) return {};
  const parseJson = (text: string): Record<string, string> | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return safeProxyRequestHeaders(parsed as Record<string, unknown>);
    } catch { /* not JSON */ }
    return null;
  };
  const json = parseJson(value);
  if (json !== null) return json;
  const normalized = value.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) return null;
  const text = bytes.toString('utf8');
  const base64Json = parseJson(text);
  if (base64Json !== null) return base64Json;
  const entries: Array<[string, string]> = [];
  try {
    for (const entry of text.split(';')) {
      const colon = entry.indexOf(':');
      if (colon <= 0 || entry.indexOf(':', colon + 1) !== -1) return null;
      const name = decodeURIComponent(entry.slice(0, colon).replace(/\+/g, ' '));
      const header = decodeURIComponent(entry.slice(colon + 1).replace(/\+/g, ' '));
      entries.push([name, header]);
    }
    return safeProxyRequestHeaders(Object.fromEntries(entries));
  } catch { return null; }
}
