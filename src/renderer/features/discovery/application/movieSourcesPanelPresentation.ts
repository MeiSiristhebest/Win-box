import type { AggVodItem } from '../../../../shared/types';
import { movieSearchTitle, searchTitleScore } from '../../../../shared/searchTitleMatching';

export interface MovieSourceCoverItem {
  id: string;
  name: string;
  year?: string;
  pic: string;
}

/** Keep the searched movie's poster from being applied to unrelated returned titles. */
export function projectMovieSourceCover(item: AggVodItem, query: string, fallbackPoster: string): MovieSourceCoverItem {
  const isFolder = item.tag === 'folder';
  return {
    id: JSON.stringify([item.sourceRef?.profileId, item.sourceKey, item.id]),
    name: isFolder ? query : movieSearchTitle(item.name),
    year: item.year,
    pic: item.pic || ((isFolder || searchTitleScore(query, item.name) > 0) ? fallbackPoster : ''),
  };
}

export function projectMovieSourceDetailQuery(item: AggVodItem): string {
  const params = new URLSearchParams({ name: item.name, pic: item.pic || '' });
  if (item.sourceRef?.profileId) params.set('profileId', item.sourceRef.profileId);
  return params.toString();
}
