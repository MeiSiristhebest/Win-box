/**
 * Normalize the upstream jar/spider field to its primary URL.
 * TVBox configurations may append metadata with `;` or list fallbacks with `|`.
 */
export function normalizeJarUrl(raw: string): string {
  const value = (raw || '').trim();
  if (!value) return '';
  const primary = value.split('|')[0].trim();
  return primary.split(';')[0].trim();
}
