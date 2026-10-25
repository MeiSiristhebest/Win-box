import type { SubtitleSearchContext, SubtitleSettings } from '../../shared/subtitle';
import { buildSearchQuery, normalizeSubtitleQuery, titleVariants } from './normalizeQuery';

/** Build the normalized, immutable input shared by every subtitle provider. */
export function createSubtitleSearchContext(resourceName: string, settings: SubtitleSettings): SubtitleSearchContext {
  const { title, ep } = normalizeSubtitleQuery(resourceName || '');
  const mainKeyword = buildSearchQuery(resourceName || '');
  const variants = titleVariants(title || '');
  const keywords = Array.from(new Set([mainKeyword, ...variants.map((value) => value + (ep ? ` ${ep}` : ''))])).filter(Boolean);
  return { title: title || mainKeyword, keywords, ep, settings };
}
