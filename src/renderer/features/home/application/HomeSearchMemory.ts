/** Serializable search view snapshot owned by the home-search feature. */
export interface HomeSearchMem {
  wd: string;
  profileId?: string;
  aggMode: boolean;
  aggScope: 'current' | 'all' | 'all-profiles';
  searchAllSources: boolean;
  searchAllProfiles?: boolean;
  /** Search report remains JSON-serializable across renderer windows. */
  agg: { items: unknown[]; perSource: unknown[]; hitSources: number; failedSources: number; totalRaw: number } | null;
  /** Current expanded folder, restored when returning from a detail page. */
  folder?: { key: string; tid: string; name: string; profileId: string; sourceName?: string } | null;
}
