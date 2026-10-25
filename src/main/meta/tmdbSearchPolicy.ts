/** Query preparation and title matching are pure TMDB search policies. */
const SEASON_NOISE = /第\s*[\d一二三四五六七八九十百零]+\s*[季部]|全\s*\d+\s*[集话話]|更新至\s*\d+\s*[集话話]?|\d+\s*[集话話]|season\s*\d+/gi;

/** Construct the metadata cache key from the normalized title and optional four-digit year. */
export function metaCacheKey(name: string, year?: string): string {
  const normalizedName = (name || '')
    .trim()
    .replace(/^[\s「『【([{]+/, '')
    .replace(/[\s」』】)\]}.，,。]+$/, '')
    .toLowerCase();
  const digits = (year || '').trim().replace(/\D/g, '');
  const normalizedYear = /^\d{4}$/.test(digits) ? digits : '';
  return `${normalizedName}|${normalizedYear}`;
}

/** Remove only trailing punctuation from a metadata search term. */
export function metaQueryName(name: string): string {
  return (name || '').trim().replace(/[\s.,，。:：\-—]+$/g, '');
}

function normalizeTitle(value: string): string {
  return (value || '')
    .replace(SEASON_NOISE, '')
    .toLowerCase()
    .replace(/[\s·:：,，.。\-—_()（）[\]【】《》「」"'’!！?？+&/\\]/g, '')
    .trim();
}

/** Accept exact normalized titles, or a title that differs only by a short sequel number. */
export function titleMatches(query: string, hitTitle: string): boolean {
  const normalizedQuery = normalizeTitle(query);
  const normalizedHit = normalizeTitle(hitTitle);
  if (!normalizedQuery || !normalizedHit) return false;
  if (normalizedQuery === normalizedHit) return true;

  const suffixDifference = (candidate: string, base: string): string | null =>
    candidate.startsWith(base)
      ? candidate.slice(base.length)
      : candidate.endsWith(base)
        ? candidate.slice(0, candidate.length - base.length)
        : null;
  const isSequelNumber = (value: string | null): boolean =>
    value !== null && value.length > 0 && value.length <= 3 && /^[0-9ivx]+$/.test(value);

  return isSequelNumber(suffixDifference(normalizedQuery, normalizedHit))
    || isSequelNumber(suffixDifference(normalizedHit, normalizedQuery));
}

/** Number of title variants and query rounds allowed for one metadata search. */
export const MAX_QUERY_VARIANTS = 4;
export const MAX_QUERY_ROUNDS = 4;

/** Return the prefix before the first four-digit year when it contains a usable title. */
export function truncAtYear(value: string): string {
  const match = /^(.*?)(?:19|20)\d{2}/.exec(value || '');
  if (!match) return '';
  const head = match[1].replace(/[\s·\-—_.,，。:：;；]+$/, '').trim();
  return head.length >= 2 ? head : '';
}

/** Build a short, ordered list of search variants for common source-title suffix noise. */
export function metaQueryVariants(name: string): string[] {
  const variants: string[] = [];
  const push = (value: string): void => {
    const normalized = value.trim();
    if (normalized.length >= 2 && !variants.includes(normalized)) variants.push(normalized);
  };
  const base = metaQueryName(name);
  push(base);
  const noise =
    /[\s·\-—_]*(?:第\s*[\d一二三四五六七八九十百零]+\s*[季部集话話期章]|全\s*[\d一二三四五六七八九十百零]*\s*[集话話季]|更新至\s*[\d一二三四五六七八九十百零]+\s*[集话話]?|共\s*[\d一二三四五六七八九十百零]+\s*[集话話]|\d+\s*[集话話]|完结|連載|连载|已完结|4K|FHD|UHD|HDTV|BluRay|BD|HD|WEB-?DL|1080[Pp]|720[Pp]|2160[Pp]|国语版|國語版|粤语版|粵語版|日语版|日語版|韩语版|原声版|原聲版|美版|日版|港版|台版|国语|國語|粤语|粵語|日语|日語|韩语|韓語|原声|原聲|中字|双字|雙字|中英双字|无删减|未删减|修复版|高清版|抢先版|完整版|动漫合集|動漫合集|合集|动漫|動漫)\s*$/i;
  let stripped = base;
  for (let i = 0; i < 5; i++) {
    const next = stripped.replace(noise, '');
    if (next === stripped) break;
    stripped = next;
  }
  push(stripped);

  const unwrapped = /^[【([〔（]\s*(.+?)\s*[】)\]〕）]$/.exec(stripped)?.[1]?.trim() ?? stripped;
  push(unwrapped);
  let noTags = stripped;
  for (let i = 0; i < 4; i++) {
    const next = noTags.replace(/[【([〔（][^】)\]〕）]*[】)\]〕）]\s*$/, '').trim();
    if (next === noTags) break;
    noTags = next;
  }
  push(noTags);
  const main = (noTags || unwrapped).split(/[·:：]/)[0].trim();
  push(main);
  push(truncAtYear(main));
  push(truncAtYear(base));
  return variants;
}
