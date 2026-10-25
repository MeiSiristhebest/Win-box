import type { ProfileSitesView, SourceBean } from '../../../../shared/types';

export interface CurrentSourcesSnapshot {
  sources: SourceBean[];
  activeSourceKey: string;
}

/** Capabilities used by the source picker; browser events and IPC stay in its adapter. */
export interface SourcePickerPort {
  loadCurrentSources(): Promise<CurrentSourcesSnapshot>;
  loadProfileSites(): Promise<ProfileSitesView>;
  setActiveSource(sourceKey: string): Promise<void>;
  activateProfile(profileId: string): Promise<void>;
  switchProfileSource(profileId: string, sourceKey: string): Promise<void>;
  publishSourceChanged(sourceKey: string): void;
  publishProfileChanged(sourceKey?: string): void;
  subscribeToCurrentSourcesRefresh(listener: () => void): () => void;
  subscribeToProfileSitesRefresh(listener: () => void): () => void;
}
