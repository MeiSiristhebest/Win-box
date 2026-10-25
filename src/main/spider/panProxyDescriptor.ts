/**
 * Parse the spider JVM's do=pan proxy query without URL: port -1 is invalid
 * to the WHATWG parser, and raw fileId values can contain their own question
 * mark. Values are decoded at most twice for diagnostics and shape detection.
 */
export function parsePanProxyQuery(proxyUrl: string): Record<string, string> {
  const out: Record<string, string> = {};
  const value = String(proxyUrl || '');
  const queryIndex = value.indexOf('?');
  const query = queryIndex >= 0 ? value.slice(queryIndex + 1) : '';
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const separatorIndex = pair.indexOf('=');
    const key = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
    const raw = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';
    let decoded = raw;
    for (let round = 0; round < 2; round++) {
      let next = '';
      try {
        next = decodeURIComponent(decoded);
      } catch {
        break;
      }
      if (next === decoded) break;
      decoded = next;
    }
    out[key] = decoded;
  }
  return out;
}
