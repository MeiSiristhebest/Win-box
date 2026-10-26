import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { AggVodItem, VodItem } from '../../../shared/types';
import { sourceIdentityKey } from '../../../shared/sourceIdentity';
import { movieSearchTitle } from '../../../shared/searchTitleMatching';
import { useCovers, type CoverItem } from '../covers/useCovers';

export function homeCoverItem(item: VodItem, sourceKey: string): CoverItem {
  return {
    id: `${sourceKey}\u0000${item.id}`,
    name: movieSearchTitle(item.name || ''),
    year: /((?:19|20)\d{2})/.exec(`${item.name} ${item.remarks || ''}`)?.[1],
    pic: item.pic,
  };
}

export function aggregateHomeCoverItem(item: AggVodItem, fallbackProfileId: string): CoverItem {
  return homeCoverItem(
    item,
    sourceIdentityKey(item.sourceRef?.profileId ?? fallbackProfileId, item.sourceKey),
  );
}

interface HomePageCoverOptions {
  browseItems: readonly VodItem[];
  searchItems: readonly AggVodItem[];
  sourceKey: string;
  profileId: string;
  visibleSearchLimit: number;
  active: boolean;
  loading: boolean;
  aggregateMode: boolean;
}

export function useHomePageCovers({
  browseItems,
  searchItems,
  sourceKey,
  profileId,
  visibleSearchLimit,
  active,
  loading,
  aggregateMode,
}: HomePageCoverOptions) {
  const browseRequests = useMemo(
    () => browseItems.map((item) => homeCoverItem(item, sourceKey)),
    [browseItems, sourceKey],
  );
  const searchRequests = useMemo(
    () => searchItems.slice(0, visibleSearchLimit).map((item) => aggregateHomeCoverItem(item, profileId)),
    [profileId, searchItems, visibleSearchLimit],
  );
  const browseCovers = useCovers(browseRequests, active && !loading && !aggregateMode);
  const searchCovers = useCovers(searchRequests, active && aggregateMode, true);

  const picOf = useCallback(
    (item: VodItem) => browseCovers.picOf(homeCoverItem(item, sourceKey)),
    [browseCovers, sourceKey],
  );
  const searchPicOf = useCallback(
    (item: AggVodItem) => searchCovers.picOf(aggregateHomeCoverItem(item, profileId)),
    [profileId, searchCovers],
  );

  const browseImageErrorRef = useRef<(item: VodItem, failedSource: string) => void>(() => undefined);
  useLayoutEffect(() => {
    browseImageErrorRef.current = (item, failedSource) => {
      browseCovers.onError(homeCoverItem(item, sourceKey), failedSource);
    };
  });
  const onImageError = useCallback((item: VodItem, failedSource: string) => {
    browseImageErrorRef.current(item, failedSource);
  }, []);

  const searchImageErrorRef = useRef<(item: AggVodItem, failedSource: string) => void>(() => undefined);
  useLayoutEffect(() => {
    searchImageErrorRef.current = (item, failedSource) => {
      searchCovers.onError(aggregateHomeCoverItem(item, profileId), failedSource);
    };
  });
  const onSearchImageError = useCallback((item: AggVodItem, failedSource: string) => {
    searchImageErrorRef.current(item, failedSource);
  }, []);

  return { picOf, searchPicOf, onImageError, onSearchImageError };
}
