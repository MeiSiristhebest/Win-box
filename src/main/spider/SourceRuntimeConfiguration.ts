import type { SiteConfig, UserConfig } from '../../shared/types';

export type SourceRuntimeConfigChangeKind = 'content' | 'ui';

export interface SourceRuntimeConfigurationPorts {
  project(config: UserConfig): SiteConfig;
  apply(config: SiteConfig): void;
  clearSpiderInstances(): void;
  invalidateSearchConfiguration(): void;
  schedulePrewarm(): void;
}

/** Owns active runtime config and synchronizes persisted or imported changes to spider services. */
export class SourceRuntimeConfiguration {
  private activeConfig: SiteConfig | null = null;

  constructor(private readonly ports: SourceRuntimeConfigurationPorts) {}

  get current(): SiteConfig | null {
    return this.activeConfig;
  }

  setCurrent(config: SiteConfig): void {
    this.activeConfig = config;
  }

  applyImportedConfig(config: SiteConfig): void {
    this.activeConfig = config;
    this.ports.apply(config);
  }

  /** UI-only selection changes skip source rebuilds, cache invalidation, and prewarming. */
  applyUserConfig(config: UserConfig, kind: SourceRuntimeConfigChangeKind = 'content'): SiteConfig | null {
    if (kind === 'ui') return null;

    const runtimeConfig = this.ports.project(config);
    this.activeConfig = runtimeConfig;
    this.ports.apply(runtimeConfig);
    this.ports.clearSpiderInstances();
    this.ports.invalidateSearchConfiguration();
    this.ports.schedulePrewarm();
    return runtimeConfig;
  }
}
