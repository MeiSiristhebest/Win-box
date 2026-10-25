import type { EngineHost } from '../../engine/ports';
import { prewarmOf, warmupOf } from '../../engine/spider/SpiderCapabilities';
import type { Spider } from '../../engine/spider/Spider';
import type { SourceSearchHealth } from '../../engine/vod/SourceSearchHealth';
import type { Logger, SourceBean } from '../../shared/types';

export interface SpiderBridgeLifecyclePort {
  setDefaultJar(url: string): void;
  warmup(url: string): Promise<void>;
  resetPool(): void;
  alivePoolCount(): number;
  armPoolShrink(): void;
  dispose(): void;
}

export interface SpiderFactoryLifecyclePort {
  createForSource(source: SourceBean, host: EngineHost): Spider;
  clear(): void;
}

export interface SpiderRuntimeLifecyclePorts {
  bridge: SpiderBridgeLifecyclePort;
  spiders: SpiderFactoryLifecyclePort;
  host: EngineHost;
  searchableSources(): readonly SourceBean[];
  sourceHealth: Pick<SourceSearchHealth, 'scheduleOrder'>;
  logger: Pick<Logger, 'i'>;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Owns spider process warmup, pool resets, and their deferred lifecycle. */
export class SpiderRuntimeLifecycle {
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly cancel: (timer: ReturnType<typeof setTimeout>) => void;
  private lastSpiderJar = '';
  private lastPrewarmAt = 0;
  private prewarmEnabled = false;
  private pendingWarmupJar = '';
  private configPrewarmTimer: ReturnType<typeof setTimeout> | null = null;
  private prewarmAfterEnable = false;
  private readonly deferredTimers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(private readonly ports: SpiderRuntimeLifecyclePorts) {
    this.now = ports.now ?? Date.now;
    this.schedule = ports.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = ports.cancel ?? ((timer) => clearTimeout(timer));
  }

  setDefaultJar(normalizedUrl: string): void {
    if (this.disposed) return;
    if (normalizedUrl === this.lastSpiderJar) return;
    this.lastSpiderJar = normalizedUrl;
    this.ports.bridge.setDefaultJar(normalizedUrl);
    if (!normalizedUrl) {
      this.pendingWarmupJar = '';
      return;
    }
    if (this.prewarmEnabled) this.ports.bridge.warmup(normalizedUrl).catch(() => undefined);
    else this.pendingWarmupJar = normalizedUrl;
  }

  enablePrewarm(): void {
    if (this.disposed) return;
    this.prewarmEnabled = true;
    const jar = this.pendingWarmupJar;
    this.pendingWarmupJar = '';
    if (jar) this.ports.bridge.warmup(jar).catch(() => undefined);
    if (this.prewarmAfterEnable) {
      this.prewarmAfterEnable = false;
      this.prewarmSources();
    }
  }

  schedulePrewarmAfterConfigChange(): void {
    if (this.disposed) return;
    if (this.configPrewarmTimer) this.cancel(this.configPrewarmTimer);
    this.configPrewarmTimer = this.defer(() => {
      this.configPrewarmTimer = null;
      if (!this.prewarmEnabled) {
        this.prewarmAfterEnable = true;
        return;
      }
      this.prewarmSources();
    }, 1_000);
  }

  prewarmPythonSources(maxSources = 5): void {
    if (this.disposed) return;
    let warmed = 0;
    for (const source of this.ports.searchableSources()) {
      if (warmed >= maxSources) break;
      if (!(source.api || '').toLowerCase().includes('.py')) continue;
      try {
        const warmup = warmupOf(this.ports.spiders.createForSource(source, this.ports.host));
        if (!warmup) continue;
        warmup.warmup();
        warmed += 1;
      } catch {
        // An unavailable or unsupported source is retried on its first real request.
      }
    }
    if (warmed > 0) {
      this.ports.logger.i(`python: 已调度 ${warmed} 个 .py 源的后台预热（脚本 + 嵌入式运行时），首次进源直接可用`);
    }
  }

  prewarmSpiders(maxKeys = 3, perKey = 1): number {
    if (this.disposed) return 0;
    if (this.now() - this.lastPrewarmAt < 30_000) return 0;
    const sources = this.ports.searchableSources();
    if (sources.length === 0) return 0;
    const order = this.ports.sourceHealth.scheduleOrder(sources);
    let started = 0;
    for (const index of order) {
      if (started >= maxKeys) break;
      const source = sources[index];
      if (!source) continue;
      try {
        const prewarm = prewarmOf(this.ports.spiders.createForSource(source, this.ports.host));
        if (!prewarm) continue;
        started += prewarm.prewarm(perKey);
      } catch {
        // Warmup is best-effort; normal source execution can retry later.
      }
    }
    if (started > 0) {
      this.lastPrewarmAt = this.now();
      this.ports.logger.i(`蜘蛛预热：已提前拉起 ${started} 个常驻进程（首次搜索免冷启动）`);
    }
    return started;
  }

  poolAliveCount(): number {
    return this.ports.bridge.alivePoolCount();
  }

  onPlaybackStarted(): void {
    this.ports.bridge.armPoolShrink();
  }

  rewarmAfterCacheClear(): void {
    if (this.disposed) return;
    this.lastPrewarmAt = 0;
    if (this.lastSpiderJar) this.ports.bridge.warmup(this.lastSpiderJar).catch(() => undefined);
    this.defer(() => {
      try { this.prewarmSpiders(3, 1); } catch { /* Best effort after cache cleanup. */ }
      try { this.prewarmPythonSources(); } catch { /* Best effort after cache cleanup. */ }
    }, 500);
  }

  clearSpiderInstances(): void {
    this.ports.spiders.clear();
  }

  resetAfterDriveCredentialChange(): void {
    this.ports.spiders.clear();
    this.ports.bridge.resetPool();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.deferredTimers) this.cancel(timer);
    this.deferredTimers.clear();
    this.configPrewarmTimer = null;
    this.ports.bridge.dispose();
  }

  private prewarmSources(): void {
    try { this.prewarmSpiders(3, 1); } catch { /* Best effort during startup. */ }
    try { this.prewarmPythonSources(); } catch { /* Best effort during startup. */ }
  }

  private defer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    let timer: ReturnType<typeof setTimeout>;
    timer = this.schedule(() => {
      this.deferredTimers.delete(timer);
      if (!this.disposed) callback();
    }, delayMs);
    this.deferredTimers.add(timer);
    timer.unref?.();
    return timer;
  }
}
