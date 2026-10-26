import { useEffect, useLayoutEffect, useState } from 'react';
import {
  HomeSearchWorkflow,
  type HomeSearchMemoryPort,
  type HomeSearchWorkflowPorts,
  type HomeSearchPresentationPort,
  type HomeSearchRoute,
  type HomeSearchState,
} from './application/HomeSearchWorkflow';
import type { HomeSearchBrowsePort } from './application/homeBrowseSearchSession';
import type { HomeSearchPort } from './application/homePorts';

type HomeSearchActions = Omit<HomeSearchPresentationPort, 'restoreHomeScrollPosition'> & {
  restoreHomeScrollPosition?(scrollTop: number): void;
};

type HomeSearchControllerOptions = {
  api: HomeSearchPort;
  runtime: Omit<HomeSearchWorkflowPorts, 'api' | 'memory'>;
  memory: HomeSearchMemoryPort;
  route: HomeSearchRoute;
  search: HomeSearchState;
  browse: HomeSearchBrowsePort;
  actions: HomeSearchActions;
};

/** React adapter for the renderer-independent home-search workflow. */
export function useHomeSearchController({ api, runtime, memory, route, search, browse, actions }: HomeSearchControllerOptions) {
  const presentation: HomeSearchPresentationPort = {
    dispatchSearch: actions.dispatchSearch,
    setSearchLoading: actions.setSearchLoading,
    setSearchError: actions.setSearchError,
    clearBrowseLoading: actions.clearBrowseLoading,
    clearBrowseResults: actions.clearBrowseResults,
    restoreBrowse: actions.restoreBrowse,
    restoreHomeScrollPosition: (scrollTop) => actions.restoreHomeScrollPosition?.(scrollTop),
    loadHome: actions.loadHome,
  };
  const context = { route, search, browse, presentation };
  const [workflow] = useState(() => new HomeSearchWorkflow({ api, memory, ...runtime }, context));

  useLayoutEffect(() => workflow.update(context, api));
  useEffect(() => () => workflow.dispose(), [workflow]);
  useEffect(
    () => workflow.handleRouteChange(),
    [workflow, route.aggParam, route.profileReady, route.requestedProfileId, route.requestedAllProfiles],
  );

  return {
    clearSearchMemory: workflow.clearSearchMemory,
    cancelPendingSearch: workflow.cancelPendingSearch,
    browseStarted: workflow.browseStarted,
    applySearchMem: workflow.applySearchMem,
    saveSearchMem: workflow.saveSearchMem,
    setProfileSearchScope: workflow.setProfileSearchScope,
    doSearch: workflow.doSearch,
    folder: search.folder,
    openFolder: workflow.openFolder,
    exitFolder: workflow.exitFolder,
    exitSearch: workflow.exitSearch,
  };
}
