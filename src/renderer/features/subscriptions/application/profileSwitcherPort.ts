import type { UserConfig } from '../../../../shared/types';

export interface ProfileSwitcherPort {
  loadConfiguration(): Promise<UserConfig>;
  activateProfile(profileId: string): Promise<void>;
  publishProfileChanged(): void;
  subscribeToProfileRefresh(listener: () => void): () => void;
}
