import { isDoubanLikeSource } from '../../../../engine/config/sourceKind';
import type { AggVodItem, SourceBean, VodItem } from '../../../../shared/types';
import { discoverDetailRoute } from '../../../../shared/discoverDetail';

export type HomeItemSourceLookupPort = {
  loadProfileSources(profileId: string): Promise<SourceBean[]>;
};

export type HomeItemNavigationAction =
  | { kind: 'folder'; sourceKey: string; profileId: string; id: string; name: string }
  | { kind: 'recommendation'; route: string }
  | { kind: 'detail'; sourceKey: string; profileId: string; id: string; poster: string; name: string };

type HomeItemNavigationRequest = {
  item: VodItem | AggVodItem;
  currentProfileId: string;
  currentSources: SourceBean[];
  fallbackSourceKey?: string;
};

/** Resolves the business destination for a browse or aggregate-search result. */
export async function resolveHomeItemNavigation(
  request: HomeItemNavigationRequest,
  sourceLookup: HomeItemSourceLookupPort,
): Promise<HomeItemNavigationAction> {
  const { item, currentProfileId } = request;
  const profileId = item.sourceRef?.profileId ?? currentProfileId;
  const sourceKey = item.sourceRef?.key || item.sourceKey || request.fallbackSourceKey || '';

  if (item.tag === 'folder') {
    return { kind: 'folder', sourceKey, profileId, id: item.id, name: item.name };
  }

  let source = request.currentSources.find((candidate) => candidate.key === sourceKey);
  if (!source && profileId) {
    try {
      source = (await sourceLookup.loadProfileSources(profileId)).find((candidate) => candidate.key === sourceKey);
    } catch {
      // Source identity still resolves to an ordinary detail page if profile metadata is unavailable.
    }
  }

  if (isDoubanLikeSource(source)) {
    return {
      kind: 'recommendation',
      route: discoverDetailRoute({
        title: item.name,
        poster: item.pic || '',
        year: Number.parseInt(item.year || '', 10) || '',
        mediaType: /剧|tv|series/i.test(item.type || '') ? 'tv' : 'movie',
      }),
    };
  }

  return {
    kind: 'detail',
    sourceKey,
    profileId,
    id: item.id,
    poster: item.pic || '',
    name: item.name,
  };
}
