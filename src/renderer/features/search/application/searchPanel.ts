import type { MetaSuggestion } from '../../../../shared/meta';
import type { MovieHotList } from '../../../../shared/types';

export interface SearchRecommendationsPort {
  loadHotList(): Promise<MovieHotList>;
  suggest(term: string): Promise<MetaSuggestion[]>;
}

export interface SearchHistoryPort {
  load(): string[];
  record(term: string): string[];
  remove(current: string[], term: string): string[];
  clear(): void;
}

export interface SearchNavigationPort {
  openSearch(term: string): Promise<void>;
}

export interface SearchPanelPorts {
  recommendations: SearchRecommendationsPort;
  history: SearchHistoryPort;
  navigation: SearchNavigationPort;
}
