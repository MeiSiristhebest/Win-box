import type { Logger } from '../../shared/types';
import type { LocalPackageReferencePort } from './LocalPackageReferencePort';
import { LiveChannelConfigurationApplicationService } from './LiveChannelConfigurationApplicationService';
import { ProfileConfigurationApplicationService } from './ProfileConfigurationApplicationService';
import { SourceConfigurationApplicationService } from './SourceConfigurationApplicationService';
import { SubscriptionGroupApplicationService } from './SubscriptionGroupApplicationService';
import { UserConfigApplicationService, type UserConfigPersistencePort } from '../store/UserConfigApplicationService';

export interface ConfigurationApplicationServices {
  userConfig: UserConfigApplicationService;
  sources: SourceConfigurationApplicationService;
  profiles: ProfileConfigurationApplicationService;
  liveChannels: LiveChannelConfigurationApplicationService;
  subscriptionGroups: SubscriptionGroupApplicationService;
}

export interface ConfigurationApplicationServicesOptions {
  persistence: UserConfigPersistencePort;
  logger: Logger;
  localPackages?: LocalPackageReferencePort;
}

/** Composition root for the user-configuration application services. */
export function createConfigurationApplicationServices(
  options: ConfigurationApplicationServicesOptions,
): ConfigurationApplicationServices {
  const userConfig = new UserConfigApplicationService(options.persistence, options.logger);
  return {
    userConfig,
    sources: new SourceConfigurationApplicationService({
      configuration: userConfig,
      localPackages: options.localPackages,
      logger: options.logger,
    }),
    profiles: new ProfileConfigurationApplicationService({
      profiles: userConfig,
      sourceLookup: {
        listSources: (profileId) => userConfig.profileConfig(profileId)?.sites.map(source => ({ ...source })) ?? [],
      },
      localPackages: options.localPackages,
      logger: options.logger,
    }),
    liveChannels: new LiveChannelConfigurationApplicationService(userConfig),
    subscriptionGroups: new SubscriptionGroupApplicationService(userConfig),
  };
}
