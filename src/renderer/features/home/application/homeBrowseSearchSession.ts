import type { VodItem } from '../../../../shared/types';
import type { HomeSortClassView } from './homePorts';

/** Browse state retained while aggregate search temporarily replaces the result list. */
export type HomeBrowseSnapshot = {
  key: string;
  items: VodItem[];
  classes: HomeSortClassView[];
  pageInfo: { page: number; pagecount: number; total: number };
  pg: number;
  tid: string;
  filters: Record<string, string>;
  fallback: boolean;
  /** Optional for compatibility with snapshots created before waterfall state was included. */
  wfNoMore?: boolean;
  lastPageSignature?: string;
};

export type HomeBrowseReturnDestination =
  | { kind: 'restore'; snapshot: HomeBrowseSnapshot }
  | { kind: 'reload'; sourceKey: string }
  | { kind: 'none' };

/** Search may coordinate a browse handoff without reading or mutating browse state directly. */
export interface HomeSearchBrowsePort {
  activeProfileId(): string;
  setActiveProfileId(profileId: string): void;
  activeSourceKey(): string;
  invalidateBrowseRequests(): void;
  preserveBrowseForSearch(aggregateMode: boolean): void;
  returnDestination(): HomeBrowseReturnDestination;
}

export type HomeBrowseSearchSessionPorts = Omit<HomeSearchBrowsePort, 'preserveBrowseForSearch' | 'returnDestination'> & {
  currentSnapshot(): HomeBrowseSnapshot | null;
};

export interface HomeBrowseSearchSession {
  port: HomeSearchBrowsePort;
  browseStarted(): void;
}

/** Owns the temporary browse snapshot handoff used while aggregate search replaces the browse list. */
export function createHomeBrowseSearchSession(ports: HomeBrowseSearchSessionPorts): HomeBrowseSearchSession {
  let snapshot: HomeBrowseSnapshot | null = null;

  return {
    port: {
      activeProfileId: ports.activeProfileId,
      setActiveProfileId: ports.setActiveProfileId,
      activeSourceKey: ports.activeSourceKey,
      invalidateBrowseRequests: ports.invalidateBrowseRequests,
      preserveBrowseForSearch(aggregateMode) {
        if (aggregateMode) return;
        const current = ports.currentSnapshot();
        if (current && current.items.length > 0) snapshot = current;
      },
      returnDestination() {
        const sourceKey = ports.activeSourceKey();
        if (snapshot && sourceKey && snapshot.key === sourceKey) {
          const restored = snapshot;
          snapshot = null;
          return { kind: 'restore', snapshot: restored };
        }
        return sourceKey ? { kind: 'reload', sourceKey } : { kind: 'none' };
      },
    },
    browseStarted() {
      snapshot = null;
    },
  };
}
