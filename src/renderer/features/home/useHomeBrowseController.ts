import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MutableRefObject } from 'react';
import { HomeBrowseWorkflow, type HomeBrowseWorkflowPorts } from './application/HomeBrowseWorkflow';
import type { HomeWaterfallObserverPort } from './application/homeWaterfallObserverPort';
import { useHomeWaterfallObserver } from './useHomeWaterfallObserver';

/** React adapter: subscribe to browse state and attach the browser-only scroll observer. */
type HomeBrowseControllerOptions = {
  ports: HomeBrowseWorkflowPorts;
  contentRef: MutableRefObject<HTMLDivElement | null>;
  aggMode: boolean;
  waterfall: boolean;
  waterfallObserver: HomeWaterfallObserverPort;
};

export function useHomeBrowseController({
  ports,
  contentRef,
  aggMode,
  waterfall,
  waterfallObserver,
}: HomeBrowseControllerOptions) {
  const [workflow] = useState(() => new HomeBrowseWorkflow(ports, {
    aggregateMode: aggMode,
    waterfall,
  }));
  workflow.updatePorts(ports);
  workflow.updateOptions({ aggregateMode: aggMode, waterfall });

  const browseState = useSyncExternalStore(
    workflow.subscribe,
    workflow.getSnapshot,
    workflow.getSnapshot,
  );
  const waterfallSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    workflow.activate();
    return () => workflow.dispose();
  }, [workflow]);

  const waterfallObserverKey = JSON.stringify([
    ports.context.activeSourceKey(),
    browseState.tid,
    browseState.pg,
    browseState.pageInfo.pagecount,
    browseState.items.length,
    browseState.loading,
    Object.entries(browseState.filtersActive).sort(([left], [right]) => left.localeCompare(right)),
  ]);
  useHomeWaterfallObserver({
    active: waterfall && !aggMode && !browseState.wfNoMore && !!browseState.tid && browseState.pageInfo.pagecount > 1,
    refreshKey: waterfallObserverKey,
    rootRef: contentRef,
    targetRef: waterfallSentinelRef,
    onVisible: workflow.loadMoreForWaterfall,
    observer: waterfallObserver,
  });

  return {
    ...browseState,
    waterfall,
    wfSentinelRef: waterfallSentinelRef,
    searchBrowsePort: workflow.searchBrowsePort,
    sessionPort: workflow.sessionPort,
    loadHome: workflow.loadHome,
    clearBrowse: workflow.clearBrowse,
    clearLoading: workflow.clearLoading,
    clearResults: workflow.clearResults,
    restoreSnapshot: workflow.restoreSnapshot,
    loadCategory: workflow.loadCategory,
    chooseCategory: workflow.chooseCategory,
    chooseFilter: workflow.chooseFilter,
    jumpPage: browseState.jumpPageInput,
    changeJumpPage: workflow.changeJumpPage,
    jumpToPage: workflow.jumpToPage,
    previousPage: workflow.previousPage,
    nextPage: workflow.nextPage,
    wfStatusText: () => workflow.waterfallStatusText(),
  };
}
