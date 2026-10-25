import type { SiteConfig, UserConfig } from '../../shared/types';
import { subscriptionStamp } from '../store/userProfileNaming';

export interface SubscriptionProfileImportStore {
  snapshot(): Pick<UserConfig, 'sources' | 'lives' | 'apiUrl'>;
  replaceImportedConfig(
    parsed: SiteConfig,
    apiUrl: string,
    options: { profileName?: string; restoreDeletedSourceKeys: readonly string[] },
  ): void;
  saveImportedAsProfile(
    name: string,
    parsed: SiteConfig,
    apiUrl: string,
    previousProfileName: string,
    restoreDeletedSourceKeys: readonly string[],
  ): void;
}

/** Applies subscription naming and profile-transition policy at the application boundary. */
export class SubscriptionProfileImportService {
  constructor(
    private readonly profiles: SubscriptionProfileImportStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  recordImportedConfig(parsed: SiteConfig, apiUrl: string, snapshot: boolean, name = ''): void {
    const customName = name.trim();
    const restoreDeletedSourceKeys = snapshot ? parsed.sites.map((site) => site.key) : [];

    if (snapshot) {
      const current = this.profiles.snapshot();
      const hasExistingContent = current.sources.length > 0 || current.lives.length > 0;
      const sameRemote = !!apiUrl && current.apiUrl === apiUrl;
      if (hasExistingContent && !sameRemote) {
        const stamp = subscriptionStamp(this.now());
        this.profiles.saveImportedAsProfile(
          customName || `新订阅 ${stamp}`,
          parsed,
          apiUrl,
          `旧订阅 ${stamp}`,
          restoreDeletedSourceKeys,
        );
        return;
      }
    }

    this.profiles.replaceImportedConfig(parsed, apiUrl, {
      profileName: customName || undefined,
      restoreDeletedSourceKeys,
    });
  }
}
