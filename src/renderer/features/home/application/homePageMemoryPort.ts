import type { HomeSearchMem } from './HomeSearchMemory';

export type HomePageMemorySnapshot = {
  profileId?: string;
  key: string;
  tid: string;
  pg: number;
  scrollTop: number;
  filters: Record<string, string>;
  search: HomeSearchMem | null;
  updatedAt?: number;
};

/** Narrow persistence boundary for restoring and saving the home-page session. */
export interface HomePageMemoryPort {
  read(): HomePageMemorySnapshot;
  update(patch: Partial<HomePageMemorySnapshot>): void;
  persist(): void;
}
