import { useCallback, useLayoutEffect, useRef } from 'react';
import type { AggVodItem, SourceBean, VodItem } from '../../../shared/types';
import {
  resolveHomeItemNavigation,
  type HomeItemNavigationAction,
  type HomeItemSourceLookupPort,
} from './application/homeItemNavigation';

export interface HomeItemNavigationPresenterOptions {
  currentProfileId: string;
  currentSources: SourceBean[];
  currentSite?: SourceBean;
  fallbackSourceKey: string;
  sourceLookup: HomeItemSourceLookupPort;
  navigate: (path: string) => void;
  openFolder: (sourceKey: string, id: string, name: string, profileId: string) => void;
  onOpenDetail: (key: string, id: string, poster?: string, name?: string, profileId?: string) => void;
}

export interface HomeItemNavigationActions {
  openBrowseItem: (item: VodItem) => void;
  openSearchResult: (item: AggVodItem) => void;
}

/** Keeps item destination resolution and stable card actions out of page view-model assembly. */
export function useHomeItemNavigationPresenter(
  options: HomeItemNavigationPresenterOptions,
): HomeItemNavigationActions {
  const latestOptions = useRef(options);
  useLayoutEffect(() => {
    latestOptions.current = options;
  });

  const dispatchNavigation = useCallback((action: HomeItemNavigationAction): void => {
    const current = latestOptions.current;
    if (action.kind === 'folder') {
      current.openFolder(action.sourceKey, action.id, action.name, action.profileId);
    } else if (action.kind === 'recommendation') {
      current.navigate(action.route);
    } else {
      current.onOpenDetail(action.sourceKey, action.id, action.poster, action.name, action.profileId);
    }
  }, []);

  const openBrowseItem = useCallback((item: VodItem): void => {
    const current = latestOptions.current;
    void resolveHomeItemNavigation({
      item,
      currentProfileId: current.currentProfileId,
      currentSources: current.currentSite ? [current.currentSite] : [],
      fallbackSourceKey: current.fallbackSourceKey,
    }, current.sourceLookup).then(dispatchNavigation);
  }, [dispatchNavigation]);

  const openSearchResult = useCallback((item: AggVodItem): void => {
    const current = latestOptions.current;
    void resolveHomeItemNavigation({
      item,
      currentProfileId: current.currentProfileId,
      currentSources: current.currentSources,
    }, current.sourceLookup).then(dispatchNavigation);
  }, [dispatchNavigation]);

  return { openBrowseItem, openSearchResult };
}
