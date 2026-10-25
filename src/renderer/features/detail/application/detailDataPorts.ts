import type { VodDetail } from '../../../../shared/types';

export interface DetailSelectionMemory {
  flag: string;
  ep: number;
  scrollTop: number;
}

export interface DetailSelectionMemoryPort {
  readSelection(key: string): DetailSelectionMemory | undefined;
  rememberSelection(key: string, selection: DetailSelectionMemory): void;
}

/** Minimum profile, detail, and selection-memory capabilities for loading a detail route. */
export interface DetailDataPort extends DetailSelectionMemoryPort {
  readActiveProfileId(): Promise<string>;
  loadDetail(key: string, id: string, profileId: string): Promise<VodDetail | null>;
}
