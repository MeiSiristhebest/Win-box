import type { SpiderHostOptionalIntegrations } from '../src/main/spider/SpiderHostServices';
import { createSpiderHostServices } from '../src/main/spider/createSpiderHostServices';
import type { LocalPkgAccess } from '../src/main/store/LocalPkgStore';
import { createConfigurationApplicationServices } from '../src/main/configuration/createConfigurationApplicationServices';
import { createMetadataService } from '../src/main/meta/createMetadataService';
import { createSubscriptionAssembly } from '../src/main/subscriptions/createSubscriptionAssembly';
import { createSpiderHostTestInfrastructure, type SpiderHostTestInfrastructureOverrides } from './spiderHostTestInfrastructure';
import type { SpiderSourceProviderPort } from '../src/engine/vod/SpiderSourcePorts';
import type { SearchReadinessPort } from '../src/main/spider/AggregateSearchCoordinator';
import type { DrivePanSharePlaybackPorts } from '../src/main/drive/DrivePanSharePlayback';
import type { SpiderHostServices } from '../src/main/spider/SpiderHostServices';
import type { EngineHost } from '../src/engine/ports';
import type { SpiderRuntimeProvider } from '../src/engine/spider/SpiderRuntimeProvider';

export interface SpiderHostIntegrationFixtureOptions {
  infrastructure?: SpiderHostTestInfrastructureOverrides;
  spiderSources?: SpiderSourceProviderPort;
  runtimeProviders?: readonly SpiderRuntimeProvider<EngineHost>[];
  aggregateSearchReadiness?: SearchReadinessPort;
  drivePanSharePlayback?: Partial<DrivePanSharePlaybackPorts>;
  probeSelfResolveUrl?: (url: string) => Promise<boolean>;
}

/** Builds the application service graph with test-owned infrastructure and explicit source ports. */
export function createSpiderHostServicesTestFixture(
  localPkgs?: LocalPkgAccess,
  integrations?: SpiderHostOptionalIntegrations,
  options: SpiderHostIntegrationFixtureOptions = {},
): SpiderHostServices {
  const infrastructure = createSpiderHostTestInfrastructure(options.infrastructure);
  const configuration = createConfigurationApplicationServices({
    persistence: infrastructure.userConfigPersistence,
    logger: infrastructure.logger,
    localPackages: localPkgs,
  });
  const services = createSpiderHostServices(infrastructure, {
    configuration,
    localPackages: localPkgs,
    integrations,
    spiderSources: options.spiderSources,
    runtimeProviders: options.runtimeProviders,
    aggregateSearchReadiness: options.aggregateSearchReadiness,
    drivePanSharePlayback: options.drivePanSharePlayback,
    probeSelfResolveUrl: options.probeSelfResolveUrl,
    createSubscriptionImports: (coordinator) => createSubscriptionAssembly({
      userDataDirectory: infrastructure.directories.userData,
      profiles: configuration.userConfig,
      logger: infrastructure.logger,
      coordinator,
      onImportProgress: () => undefined,
      onPersistenceError: () => undefined,
    }).imports,
  });
  return services;
}

export function createMetadataServiceIntegrationFixture() {
  const infrastructure = createSpiderHostTestInfrastructure();
  return createMetadataService({
    userDataDir: infrastructure.directories.userData,
    cacheDir: infrastructure.directories.cache,
    logger: infrastructure.logger,
    driveCodec: infrastructure.credentialCodec,
    metadataProviders: async () => [],
    discoverySources: async () => [],
  });
}
