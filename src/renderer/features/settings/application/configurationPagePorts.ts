import type { UserConfig } from '../../../../shared/types';

export interface ConfigurationSnapshotPort {
  load(): Promise<UserConfig>;
  announceSourcesChanged(): void;
}

export interface ProfileActivationPort {
  activate(profileId: string): Promise<void>;
  announceProfileChanged(): void;
}
