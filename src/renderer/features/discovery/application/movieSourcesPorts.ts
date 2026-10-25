import type { AggVodItem, SearchAllProgressEvent, SearchAllReport, VodItem } from '../../../../shared/types';

export interface MovieSourcesSearchScope {
  activeProfileId: string;
  profileIds: string[];
  hasConfiguredSources: boolean;
}

export interface MovieSourcesSearchOptions {
  refresh: boolean;
  profileId?: string;
  profileIds?: string[];
}

/** Narrow search capability required by the aggregate movie-sources use case. */
export interface MovieSourcesSearchPort {
  readScope(): Promise<MovieSourcesSearchScope>;
  onProgress(listener: (event: SearchAllProgressEvent) => void): () => void;
  searchAll(query: string, options: MovieSourcesSearchOptions): Promise<SearchAllReport>;
}

export interface MovieSourceCategoryRequest {
  key: string;
  tid: string;
  pg: string;
  extend: Record<string, string>;
  profileId?: string;
}

/** Category access is separate from cross-profile search so each consumer depends on only what it needs. */
export interface MovieSourceFolderPort {
  category(request: MovieSourceCategoryRequest): Promise<{ items: VodItem[] }>;
}

export type MovieSourceFolderIdentity = Pick<AggVodItem,
  'id' | 'name' | 'sourceKey' | 'sourceRef' | 'sourceName' | 'sourceProfileName'>;
