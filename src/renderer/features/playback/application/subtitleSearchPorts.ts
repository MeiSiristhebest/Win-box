import type {
  SubtitleCandidate,
  SubtitleFetchResult,
  SubtitleProviderView,
  SubtitleSearchReport,
} from '../../../../shared/subtitle';

export interface SubtitleSearchPort {
  listProviders(): Promise<SubtitleProviderView[]>;
  search(query: string): Promise<SubtitleSearchReport>;
  fetch(candidate: SubtitleCandidate): Promise<SubtitleFetchResult>;
  enableSubtitles(): Promise<unknown>;
}

export interface SubtitleQueryMemoryPort {
  load(): Record<string, string>;
  save(queries: Record<string, string>): void;
}

export interface SubtitleSearchDependencies {
  service: SubtitleSearchPort;
  queryMemory: SubtitleQueryMemoryPort;
}
