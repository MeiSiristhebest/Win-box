import type { SourceBean, SiteConfig } from '../../shared/types';
import { isSearchableSource } from '../../engine/vod/aggSearch';
import { raceTimeout } from '../../engine/vod/searchRuntime';
import { normalizeJarUrl } from '../../engine/spider/jarSpiderUrl';
import { SpiderLiveContentAdapter } from '../../engine/spider/SpiderLiveContentAdapter';
import { createDriveAccountAssembly } from '../drive/createDriveAccountAssembly';
import { createDriveSharePlaybackAssembly } from '../drive/createDriveSharePlaybackAssembly';
import { createLivePlaybackAssembly } from '../live/createLivePlaybackAssembly';
import { ParseService } from '../parse/ParseService';
import { sniffMediaUrl } from '../parse/PageSniffer';
import { fetchSubscriptionConfig } from '../subscriptions/SubscriptionConfigFetcher';
import { projectUserConfigToSiteConfig } from '../store/userConfigRuntimeProjection';
import { DriveBindingRequirementLearning } from './DriveBindingRequirementLearning';
import { SourceExecutionContext } from './SourceExecutionContext';
import { SourceCatalogApplicationService } from './SourceCatalogApplicationService';
import { SourceDiagnosticsApplicationService } from './SourceDiagnosticsApplicationService';
import { SourceRuntimeConfiguration } from './SourceRuntimeConfiguration';
import { SpiderPlaybackRequestService } from './SpiderPlaybackRequestService';
import { PythonSourceProxyApplicationService } from './PythonSourceProxyApplicationService';
import { createSpiderPlaybackAssembly } from './createSpiderPlaybackAssembly';
import { createSpiderRuntimeAssembly } from './createSpiderRuntimeAssembly';
import { createSpiderSourceAssembly } from './createSpiderSourceAssembly';
import { diagTimer, logPlayDiag, redactUrl, shortHash } from '../util/playDiag';
import { directPlayUrlError } from '../../shared/playbackResult';
import { isBaiduPanDescriptor } from './isBaiduPanDescriptor';
import type { SpiderHostDependencies, SpiderHostServices } from './SpiderHostServices';
import type { SpiderRuntimeLifecycle } from './SpiderRuntimeLifecycle';
import type { AggregateSearchCoordinator } from './AggregateSearchCoordinator';
import type { DriveStore } from '../store/DriveStore';
import type { UcTvStore } from '../store/UcTvStore';
import type { DriveAccountService } from '../drive/DriveAccountService';
import type { DriveCredentialSynchronizer } from '../drive/DriveCredentialSynchronizer';
import type { SourceRuntimeConfiguration as SourceRuntimeConfigurationType } from './SourceRuntimeConfiguration';
import type { SpiderHostInfrastructurePorts } from './SpiderHostInfrastructurePorts';
import type { SelfResolveMediaProbe } from '../net/SelfResolveMediaProbe';

/**
 * Main-process composition root for the source runtime and its cross-domain services.
 * Production wiring and tests consume the returned services through their declared capabilities.
 */
export function createSpiderHostServices(
  infrastructure: SpiderHostInfrastructurePorts,
  dependencies: SpiderHostDependencies,
): SpiderHostServices {
  const { directories, credentialCodec, logger } = infrastructure;
  const { configuration, localPackages, integrations = {} } = dependencies;
  const userConfig = configuration.userConfig;
  const http = infrastructure.http;
  const kv = infrastructure.runtimeStore;
  const parseService = new ParseService(http, logger, sniffMediaUrl);

  let drives!: DriveStore;
  let ucTvStore!: UcTvStore;
  let driveCredentialSynchronizer!: DriveCredentialSynchronizer;
  let driveAccounts!: DriveAccountService;
  let spiderRuntime!: SpiderRuntimeLifecycle;
  let aggregateSearch!: AggregateSearchCoordinator;
  let sourceRuntimeConfiguration!: SourceRuntimeConfigurationType;
  let selfResolveMediaProbe!: SelfResolveMediaProbe;

  const syncDriveFiles = (): void => {
    driveCredentialSynchronizer.sync(drives.list(), ucTvStore.get());
  };
  const resetSpidersAfterDriveChange = (): void => {
    aggregateSearch.invalidateCredentials();
    spiderRuntime.resetAfterDriveCredentialChange();
  };

  const driveAccountAssembly = createDriveAccountAssembly({
    userDataDirectory: directories.userData,
    spiderCacheDirectory: directories.spiderCache,
    http,
    logger,
    credentialCodec,
    sites: () => sourceRuntimeConfiguration.current?.sites ?? [],
    syncCredentialFiles: syncDriveFiles,
    resetSpiderRuntime: resetSpidersAfterDriveChange,
  });
  drives = driveAccountAssembly.drives;
  ucTvStore = driveAccountAssembly.ucTvStore;
  driveCredentialSynchronizer = driveAccountAssembly.credentialSynchronizer;
  driveAccounts = driveAccountAssembly.accounts;

  const runtime = createSpiderRuntimeAssembly({
    http,
    kv,
    logger,
    driveTokens: () => drives.list(),
    resourcesDirectory: directories.resources,
    cacheDirectory: directories.cache,
    spiderCacheDirectory: directories.spiderCache,
    workerBundlePath: directories.workerBundle,
    runtimeProviders: dependencies.runtimeProviders,
  });
  const engineHost = runtime.host;
  const spiderLiveContent = new SpiderLiveContentAdapter(runtime.spiders, engineHost);

  const livePlayback = createLivePlaybackAssembly({
    cacheDirectory: directories.cache,
    http,
    logger,
    config: () => sourceRuntimeConfiguration.current,
    loadSpiderContent: async (live, config) => {
      const api = live.api || live.url;
      const source = config.sites.find((item) => item.api === api || item.key === api);
      if (!source) throw new Error(`直播蜘蛛不存在：${api}`);
      return spiderLiveContent.load(source, live.api || live.url);
    },
    fetchLiveText: async (url) => (await http.request({ url, method: 'get', timeoutMs: 30000 })).content,
    pluginTemplates: () => integrations.liveTemplates?.() ?? Promise.resolve([]),
  }).service;

  const sourceExecutionContext = new SourceExecutionContext({
    activeProfileId: () => userConfig.activeProfileId(),
    activeConfig: () => sourceRuntimeConfiguration.current,
    findProfile: (profileId) => userConfig.rawProfiles().find((profile) => profile.id === profileId) ?? null,
    profileConfig: (profileId) => userConfig.profileConfig(profileId),
    activeSource: (key) => sourceRuntimeConfiguration.current?.sites.find((source) => source.key === key) ?? null,
  });
  const pythonSourceProxy = new PythonSourceProxyApplicationService({
    sources: sourceExecutionContext,
    spiders: {
      createForSource: (source) => runtime.spiders.createForSource(source, engineHost),
    },
  });
  const searchableSites = (profileId?: string, executionConfig?: SiteConfig | null): SourceBean[] => {
    const context = executionConfig === undefined
      ? sourceExecutionContext.forProfile(profileId)
      : { profileId: profileId || '', config: executionConfig };
    return (context.config?.sites ?? [])
      .filter((source) => isSearchableSource(source))
      .map((source) => ({ ...source, runtimeScope: JSON.stringify([context.profileId, source.key]) }));
  };

  const sourceServices = createSpiderSourceAssembly({
    runtimeHost: engineHost,
    bridge: runtime.bridge,
    spiders: runtime.spiders,
    logger,
    searchableSources: () => searchableSites(),
    profiles: {
      list: () => userConfig.rawProfiles(),
      executionContext: (profileId) => sourceExecutionContext.forProfile(profileId),
      revision: () => userConfig.revision,
      activeProfileId: () => userConfig.activeProfileId(),
      activeSourceKey: () => userConfig.activeSourceKey(),
    },
    searchableSourcesByProfile: searchableSites,
    spiderSources: dependencies.spiderSources,
    aggregateSearchReadiness: dependencies.aggregateSearchReadiness,
  });
  spiderRuntime = sourceServices.runtime;
  aggregateSearch = sourceServices.aggregateSearch;

  const driveBindingLearning = new DriveBindingRequirementLearning(
    infrastructure.learnedDriveBindingStore,
    logger,
  );
  const sourceCatalog = new SourceCatalogApplicationService({
    execution: sourceExecutionContext,
    gateway: sourceServices.gateway,
    detailLoaded: (source, _profileId, detail) => driveBindingLearning.learnFromDetail(source.key, detail),
  });
  sourceRuntimeConfiguration = new SourceRuntimeConfiguration({
    project: projectUserConfigToSiteConfig,
    apply: (config) => spiderRuntime.setDefaultJar(normalizeJarUrl(config.spider)),
    clearSpiderInstances: () => spiderRuntime.clearSpiderInstances(),
    invalidateSearchConfiguration: () => aggregateSearch.invalidateConfiguration(),
    schedulePrewarm: () => spiderRuntime.schedulePrewarmAfterConfigChange(),
  });
  const sourceDiagnostics = new SourceDiagnosticsApplicationService({
    catalog: {
      currentSources: () => sourceRuntimeConfiguration.current?.sites ?? [],
      findSource: (key) => sourceExecutionContext.forRequest(key) ?? null,
    },
    gateway: { home: (source) => sourceServices.gateway.home(source) },
    http,
    logger,
    globalSpiderJar: () => sourceRuntimeConfiguration.current?.spider || '',
    withTimeout: raceTimeout,
    now: Date.now,
  });

  const drivePlayback = createDriveSharePlaybackAssembly({
    userDataDirectory: directories.userData,
    logger,
    cookie: (provider) => driveAccounts.list()[provider] || '',
    isBaiduDescriptor: isBaiduPanDescriptor,
    panSharePlaybackPorts: dependencies.drivePanSharePlayback,
  });
  const playbackServices = createSpiderPlaybackAssembly({
    playSpider: (source, flag, id, vipFlags) => sourceServices.gateway.play(source, flag, id, vipFlags),
    proxyPortFor: (source) => sourceServices.gateway.proxyPortFor?.(source) ?? null,
    nativeDriveSharePlayback: drivePlayback.nativeSharePlayback,
    panSharePlayback: drivePlayback.panSharePlayback,
    logger,
    vipFlags: () => sourceRuntimeConfiguration.current?.flags ?? [],
    driveTokens: () => driveAccounts.list(),
    markDriveBindNeeded: (key) => driveBindingLearning.markRequired(key),
    driveBindProviderForGenericAuth: (message, key) => driveBindingLearning.providerForGenericAuth(message, key),
    rememberDriveBindProvider: (key, provider) => driveBindingLearning.rememberProvider(key, provider),
    syncDriveFiles,
    resetSpidersAfterDriveChange,
    probeSelfResolveUrl: dependencies.probeSelfResolveUrl ?? ((url) => selfResolveMediaProbe.probe(url)),
    isBaiduPanDescriptor,
    parser: { resolve: (parses, target, offset) => parseService.resolve(parses, target, offset) },
    torrentPlay: () => integrations.torrentPlayback,
  });
  selfResolveMediaProbe = playbackServices.mediaProbe;
  const playbackRequest = new SpiderPlaybackRequestService({
    execution: sourceExecutionContext,
    playback: playbackServices.playback,
    startTimer: () => diagTimer(),
    episodeFingerprint: shortHash,
    safeUrlSummary: redactUrl,
    directPlayUrlError,
    recordDiagnostic: logPlayDiag,
  });

  const subscriptionImports = dependencies.createSubscriptionImports({
    fetchConfigWithDiagnostics: (url, quick, signal) =>
      fetchSubscriptionConfig({ http, logger, localPkgs: localPackages }, url, quick, signal),
    currentConfig: () => sourceRuntimeConfiguration.current,
    setCurrentConfig: (config) => sourceRuntimeConfiguration.setCurrent(config),
    applyRuntimeConfig: (config) => sourceRuntimeConfiguration.applyImportedConfig(config),
  });

  userConfig.setOnChange((snapshot, kind) => sourceRuntimeConfiguration.applyUserConfig(snapshot, kind));
  if (userConfig.load()) sourceRuntimeConfiguration.applyUserConfig(userConfig.snapshot());

  return {
    bridge: runtime.bridge,
    aggregateSearch,
    aggregateSearchRunner: sourceServices.aggregateSearch,
    spiderRuntime,
    sourceConfiguration: configuration.sources,
    profileConfiguration: configuration.profiles,
    liveChannelConfiguration: configuration.liveChannels,
    subscriptionGroups: configuration.subscriptionGroups,
    sourceCatalog,
    sourceDiagnostics,
    drives,
    driveAccounts,
    driveCredentialSynchronizer,
    ucTvStore,
    driveFileCleanup: drivePlayback.cleanup,
    playbackRequest,
    pythonSourceProxy,
    selfResolveMediaProbe: playbackServices.mediaProbe,
    sourceRuntimeConfiguration,
    subscriptionImports,
    livePlayback,
    driveBindingLearning,
  };
}
