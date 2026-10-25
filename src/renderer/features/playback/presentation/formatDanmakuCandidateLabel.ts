import { seasonOf } from '../../../../engine/danmaku/episodeMetadata';
import type { DanmakuCandidateLabelInput } from '../application/danmakuCandidateLabel';

function fullWidthToHalfWidth(value: string): string {
  return value
    .replace(/[\uff01-\uff5e]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

function withoutLeadingZeros(value: string): string {
  return value.replace(/^0+/, '') || '0';
}

/** Extract an episode number from the common title formats used by danmaku sources. */
function episodeNumberFrom(value: string): string {
  const text = fullWidthToHalfWidth((value || '').trim());
  if (!text) return '';
  const latin = /[Ss]\d{1,2}\s*[Ee]\s*(\d{1,4})/.exec(text);
  if (latin) return withoutLeadingZeros(latin[1]);
  const chinese = /第\s*(\d{1,4})\s*[集话期]/.exec(text);
  if (chinese) return withoutLeadingZeros(chinese[1]);
  const latest = /(?:更新至|至)\s*(\d{1,4})\s*[集话期]?/.exec(text);
  if (latest) return withoutLeadingZeros(latest[1]);
  const numeric = /^\s*(\d{1,4})\s*$/.exec(text);
  if (numeric && !/^(?:19|20)\d{2}$/.test(numeric[1])) return withoutLeadingZeros(numeric[1]);
  return '';
}

/**
 * Format raw danmaku metadata for a compact, readable candidate label.
 * Platform/type noise and season/episode suffixes are removed from the work title;
 * known year, season, and episode metadata is then presented in a stable order.
 */
export function formatDanmakuCandidateLabel({ title, episodeTitle, episodeNumber }: DanmakuCandidateLabelInput = {}): string {
  const raw = fullWidthToHalfWidth((title || '').trim());
  const yearMatch = /[（([]?\s*((?:19|20)\d{2})\s*[）)\]]?/.exec(raw);
  const year = yearMatch ? yearMatch[1] : '';
  const explicitEpisodeNumber = (episodeNumber || '').trim();
  const episode = episodeNumberFrom(episodeTitle || '') ||
    (/^\d{1,4}$/.test(explicitEpisodeNumber) ? withoutLeadingZeros(explicitEpisodeNumber) : '') ||
    episodeNumberFrom(raw);
  const season = seasonOf(raw) ?? seasonOf(episodeTitle || '');
  let name = raw
    .replace(/[（([]\s*(?:19|20)\d{2}\s*[）)\]]/g, ' ')
    .replace(/\bfrom\s*[^\s（()\u4e00-\u9fa5]+/gi, ' ')
    .replace(/[（([【]\s*(?:3D)?(?:动漫|动画|国漫|日漫|电视剧|电影|综艺|纪录片|TV|OVA)\s*[）)\]】]/gi, ' ')
    .replace(/第\s*(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[季部]/g, ' ')
    .replace(/[Ss](?:eason)?\s*\d{1,2}\s*[Ee]\s*\d{1,4}/g, ' ')
    .replace(/[Ss]\s*\d{1,2}(?![0-9A-Za-z])/g, ' ')
    .replace(/第\s*\d{1,4}\s*[集话期]/g, ' ')
    .replace(/(?:更新至|全)\s*\d{1,4}\s*[集话期]?/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—·:：|]+$/g, '')
    .trim();
  if (!name) name = raw;
  const nameComesFromEpisode = !name;
  if (nameComesFromEpisode) name = (episodeTitle || '').trim();
  if (!name) return '';
  const parts: string[] = [year ? `${name}（${year}）` : name];
  if (season != null) parts.push(`第${season}季`);
  if (episode && !nameComesFromEpisode) parts.push(`第${episode}集`);
  return parts.join(' · ');
}
