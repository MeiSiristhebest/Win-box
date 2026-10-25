import type { SourceBean } from '../../shared/types';
import { runtimePreparationOf } from '../../engine/spider/SpiderCapabilities';
import type { SpiderFactoryPort } from '../../engine/spider/SpiderFactoryPort';
import type { SourceRuntimeReadinessPort, SourceRuntimeReadinessSnapshot } from '../../engine/vod/SearchSourceReadiness';

/** Bridges Spider runtime capabilities into the source-search readiness port. */
export class SpiderSearchRuntimeReadinessAdapter<THost> implements SourceRuntimeReadinessPort {
  constructor(
    private readonly factory: SpiderFactoryPort<THost>,
    private readonly host: THost,
  ) {}

  inspect(source: SourceBean): SourceRuntimeReadinessSnapshot | null {
    if (source.type !== 3) return null;
    const spider = this.factory.createForSource(source, this.host);
    const runtime = runtimePreparationOf(spider);
    if (!runtime) return null;
    return {
      state: runtime.runtimeState(),
      reason: spider.lastReason || '',
      ...(runtime.pendingRuntime ? { waitUntilReady: () => runtime.pendingRuntime!() } : {}),
    };
  }
}
