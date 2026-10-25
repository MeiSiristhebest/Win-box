import type { Logger, SourceBean, SourceMoveDirection, SourceUpdatePatch, UserConfig } from '../../shared/types';
import type { LocalPackageReferencePort } from './LocalPackageReferencePort';

/** Consumer-owned persistence port for source configuration use cases. */
export interface SourceConfigurationStorePort {
  snapshot(): UserConfig;
  restore(snapshot: UserConfig): void;
  sources(): SourceBean[];
  addSource(source: SourceBean): SourceBean;
  updateSource(key: string, patch: SourceUpdatePatch): SourceBean;
  deleteSources(keys: readonly string[]): void;
  setGlobalSourceBlock(keys: readonly string[], blocked: boolean): void;
  moveSource(key: string, direction: SourceMoveDirection): void;
  setActiveSource(key: string): void;
}

export interface SourceConfigurationApplicationServiceOptions {
  configuration: SourceConfigurationStorePort;
  localPackages?: LocalPackageReferencePort;
  logger: Pick<Logger, 'w'>;
}

/** Source catalog configuration use cases; IPC and startup migration share this boundary. */
export class SourceConfigurationApplicationService {
  constructor(private readonly options: SourceConfigurationApplicationServiceOptions) {}

  /** Renderer snapshot with the normalized active-profile source list. */
  getSnapshot(): UserConfig {
    return { ...this.options.configuration.snapshot(), sources: this.options.configuration.sources() };
  }

  initializeLocalImports(): void {
    try {
      const before = this.options.configuration.snapshot();
      const after = this.options.localPackages?.migrateConfig?.(before, message => this.options.logger.w(message));
      if (after && JSON.stringify(after) !== JSON.stringify(before)) this.options.configuration.restore(after);
    } catch (error) {
      this.options.logger.w(`本地导入副本迁移失败（原文件保留）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  addSource(source: SourceBean): SourceBean {
    return this.options.configuration.addSource(source);
  }

  updateSource(key: string, patch: SourceUpdatePatch): SourceBean {
    return this.options.configuration.updateSource(key, patch);
  }

  deleteSource(key: string): void {
    this.deleteSources([key]);
  }

  deleteSources(keys: readonly string[]): void {
    const before = this.options.configuration.snapshot();
    this.options.configuration.deleteSources(keys);
    this.cleanupRemovedLocalImports(before);
  }

  setGlobalSourceBlock(keys: readonly string[], blocked: boolean): void {
    this.options.configuration.setGlobalSourceBlock(keys, blocked);
  }

  moveSource(key: string, direction: SourceMoveDirection): void {
    this.options.configuration.moveSource(key, direction);
  }

  selectActiveSource(key: string): void {
    this.options.configuration.setActiveSource(key);
  }

  private cleanupRemovedLocalImports(before: UserConfig): void {
    try {
      this.options.localPackages?.cleanupRemoved?.(before, this.options.configuration.snapshot());
    } catch (error) {
      this.options.logger.w(`本地导入副本清理失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
