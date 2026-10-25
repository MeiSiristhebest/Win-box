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
