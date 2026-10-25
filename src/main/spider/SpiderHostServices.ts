import type { JarSpiderBridge } from '../../engine/spider/JarSpiderBridge';
import type { AggregateSearchCoordinator, AggregateSearchRunnerPort } from './AggregateSearchCoordinator';
import type { DriveAccountService } from '../drive/DriveAccountService';
import type { DriveCredentialSynchronizer } from '../drive/DriveCredentialSynchronizer';
import type { DriveFileCleanupService } from '../drive/DriveFileCleanupService';
import type { LivePlaybackService } from '../live/LivePlaybackService';
import type { LocalPkgAccess } from '../store/LocalPkgStore';
import type { DriveStore } from '../store/DriveStore';
import type { UcTvStore } from '../store/UcTvStore';
import type { SubscriptionImportRuntimePorts } from '../subscriptions/createSubscriptionAssembly';
import type { SubscriptionImportApplicationService } from '../subscriptions/SubscriptionImportApplicationService';
import type { TorrentPlaybackPort } from './SpiderPlaybackService';
import type { SpiderRuntimeLifecycle } from './SpiderRuntimeLifecycle';
import type { SourceRuntimeConfiguration } from './SourceRuntimeConfiguration';
import type { SpiderPlaybackRequestService } from './SpiderPlaybackRequestService';
import type { SourceCatalogApplicationService } from './SourceCatalogApplicationService';
import type { SourceDiagnosticsApplicationService } from './SourceDiagnosticsApplicationService';
import type { DriveBindingRequirementLearning } from './DriveBindingRequirementLearning';
import type { SourceConfigurationApplicationService } from '../configuration/SourceConfigurationApplicationService';
import type { ProfileConfigurationApplicationService } from '../configuration/ProfileConfigurationApplicationService';
import type { LiveChannelConfigurationApplicationService } from '../configuration/LiveChannelConfigurationApplicationService';
import type { SubscriptionGroupApplicationService } from '../configuration/SubscriptionGroupApplicationService';
import type { ConfigurationApplicationServices } from '../configuration/createConfigurationApplicationServices';
import type { SelfResolveMediaProbe } from '../net/SelfResolveMediaProbe';
import type { PythonSourceProxyApplicationService } from './PythonSourceProxyApplicationService';
import type { LiveTemplate } from '../plugin/pluginLiveTemplate';
import type { SpiderSourceProviderPort } from '../../engine/vod/SpiderSourcePorts';
import type { SearchReadinessPort } from './AggregateSearchCoordinator';
import type { DrivePanSharePlaybackPorts } from '../drive/DrivePanSharePlayback';

/** Optional capabilities supplied by the application composition root. */
export interface SpiderHostOptionalIntegrations {
  torrentPlayback?: TorrentPlaybackPort;
  liveTemplates?: () => Promise<LiveTemplate[]>;
}

export interface SpiderHostDependencies {
  configuration: ConfigurationApplicationServices;
  createSubscriptionImports: (ports: SubscriptionImportRuntimePorts) => SubscriptionImportApplicationService;
  localPackages?: LocalPkgAccess;
  integrations?: SpiderHostOptionalIntegrations;
  /** Consumer-owned source capabilities and readiness may be replaced at the composition boundary. */
  spiderSources?: SpiderSourceProviderPort;
  aggregateSearchReadiness?: SearchReadinessPort;
  /** External playback effects remain replaceable without exposing runtime internals. */
  drivePanSharePlayback?: Partial<DrivePanSharePlaybackPorts>;
  probeSelfResolveUrl?: (url: string) => Promise<boolean>;
}

/** Runtime services assembled once by the main-process composition root. */
export interface SpiderHostServices {
  readonly bridge: JarSpiderBridge;
  readonly aggregateSearch: AggregateSearchCoordinator;
  readonly aggregateSearchRunner: AggregateSearchRunnerPort;
  readonly spiderRuntime: SpiderRuntimeLifecycle;
  readonly sourceConfiguration: SourceConfigurationApplicationService;
  readonly profileConfiguration: ProfileConfigurationApplicationService;
  readonly liveChannelConfiguration: LiveChannelConfigurationApplicationService;
  readonly subscriptionGroups: SubscriptionGroupApplicationService;
  readonly sourceCatalog: SourceCatalogApplicationService;
  readonly sourceDiagnostics: SourceDiagnosticsApplicationService;
  readonly drives: DriveStore;
  readonly driveAccounts: DriveAccountService;
  readonly driveCredentialSynchronizer: DriveCredentialSynchronizer;
  readonly ucTvStore: UcTvStore;
  readonly driveFileCleanup: DriveFileCleanupService;
  readonly playbackRequest: SpiderPlaybackRequestService;
  readonly pythonSourceProxy: PythonSourceProxyApplicationService;
  readonly selfResolveMediaProbe: SelfResolveMediaProbe;
  readonly sourceRuntimeConfiguration: SourceRuntimeConfiguration;
  readonly subscriptionImports: SubscriptionImportApplicationService;
  readonly livePlayback: LivePlaybackService;
  readonly driveBindingLearning: DriveBindingRequirementLearning;
}
