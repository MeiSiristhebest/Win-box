export interface CoverLookupSettings {
  key: string;
  hasTmdb: boolean;
}

export type CoverProvider = 'tmdb' | 'douban';

export interface CoverLookupPort {
  loadSettings(): Promise<CoverLookupSettings>;
  searchPoster(name: string, year: string | undefined, provider: CoverProvider): Promise<string>;
}

/** Supplies browser event delivery without exposing DOM globals to the cover workflow. */
export interface CoverSettingsChangesPort {
  subscribe(listener: () => void): () => void;
}

/** Supplies image validation and source URL adaptation at the browser boundary. */
export interface CoverImagePort {
  validate(url: string): Promise<boolean>;
  relay(url: string): string;
}

export interface CoverClockPort {
  now(): number;
}

/** Application composition contract used by the cover presentation workflow. */
export interface CoverRuntimePorts {
  lookup: CoverLookupPort;
  settingsChanges: CoverSettingsChangesPort;
  images: CoverImagePort;
  clock: CoverClockPort;
}
