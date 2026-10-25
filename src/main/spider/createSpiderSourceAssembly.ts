import type { EngineHost } from '../../engine/ports';
import { FairProfileWorkerBudget, raceTimeout } from '../../engine/vod/searchRuntime';
import { sourceTimeoutMs } from '../../engine/spider/sourceTimeout';
import { CmsSource } from '../../engine/vod/CmsSource';
import { CmsSourceAdapter } from '../../engine/vod/CmsSourceAdapter';
import { SourceGateway } from '../../engine/vod/SourceGateway';
import { SpiderSourceAdapter } from '../../engine/vod/SpiderSourceAdapter';
import { SpiderSourceRuntimeAdapter } from '../../engine/spider/SpiderSourceRuntimeAdapter';
import type { Logger, SourceBean } from '../../shared/types';
import { AggregateSearchCoordinator, type AggregateSearchDependencies } from './AggregateSearchCoordinator';
import { SpiderRuntimeLifecycle } from './SpiderRuntimeLifecycle';
import { SpiderSearchRuntimeReadinessAdapter } from './SpiderSearchRuntimeReadinessAdapter';
import { SearchSourceReadiness } from '../../engine/vod/SearchSourceReadiness';
import { SpiderFactory } from '../../engine/spider/SpiderFactory';
import { JarSpiderBridge } from '../../engine/spider/JarSpiderBridge';
import { SourceSearchHealth } from '../../engine/vod/SourceSearchHealth';
import type { SpiderSourceProviderPort } from '../../engine/vod/SpiderSourcePorts';

export interface SpiderSourceAssemblyOptions {
  runtimeHost: EngineHost;
  bridge: JarSpiderBridge;
  spiders: SpiderFactory;
  logger: Logger;
  searchableSources: () => SourceBean[];
  profiles: AggregateSearchDependencies['profiles'];
  searchableSourcesByProfile: AggregateSearchDependencies['sources']['searchable'];
  spiderSources?: SpiderSourceProviderPort;
  aggregateSearchReadiness?: AggregateSearchDependencies['readiness'];
}

export interface SpiderSourceAssembly {
  gateway: SourceGateway;
  readiness: AggregateSearchDependencies['readiness'];
  aggregateSearch: AggregateSearchCoordinator;
  runtime: SpiderRuntimeLifecycle;
}

/** Composes the source gateway, search scheduler, and runtime lifecycle as one source subsystem. */
export function createSpiderSourceAssembly(options: SpiderSourceAssemblyOptions): SpiderSourceAssembly {
  const searchHealth = new SourceSearchHealth();
  const cmsAdapter = new CmsSourceAdapter(new CmsSource(options.runtimeHost));
  const spiderAdapter = new SpiderSourceAdapter(
    options.spiderSources ?? new SpiderSourceRuntimeAdapter(options.spiders, options.runtimeHost),
    options.logger,
  );
  const gateway = new SourceGateway(
    {
      catalog: [cmsAdapter, spiderAdapter],
      playback: [cmsAdapter, spiderAdapter],
      proxy: [spiderAdapter],
    },
    options.logger,
  );
  const readiness = options.aggregateSearchReadiness ?? new SearchSourceReadiness(
    new SpiderSearchRuntimeReadinessAdapter(options.spiders, options.runtimeHost),
    options.logger,
  );
  const aggregateSearch = new AggregateSearchCoordinator({
    profiles: options.profiles,
    sources: {
      searchable: options.searchableSourcesByProfile,
      search: (source, term, timeoutMs, signal) =>
        gateway.search(source, term, false, timeoutMs, signal),
    },
    readiness,
    createWorkerBudget: (limit, profileIds, initiallyActiveProfileIds) =>
      new FairProfileWorkerBudget(limit, profileIds, initiallyActiveProfileIds),
    health: {
      scheduleOrder: (sources) => searchHealth.scheduleOrder(sources),
      sourceBudget: (source, maximumMs) =>
        searchHealth.budget(source, sourceTimeoutMs(source), maximumMs),
      succeeded: (scope, elapsedMs, empty) => searchHealth.succeeded(scope, elapsedMs, empty),
      failed: (scope) => searchHealth.failed(scope),
    },
    timing: {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle),
      withTimeout: raceTimeout,
    },
    logger: options.logger,
  });
  const runtime = new SpiderRuntimeLifecycle({
    bridge: options.bridge,
    spiders: options.spiders,
    host: options.runtimeHost,
    searchableSources: options.searchableSources,
    sourceHealth: searchHealth,
    logger: options.logger,
  });

  return { gateway, readiness, aggregateSearch, runtime };
}
