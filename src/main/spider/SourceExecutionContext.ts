import type { SiteConfig, SourceBean } from '../../shared/types';
import { normalizeSourcePaths, resolveRelativeValue } from '../store/userConfigRuntimeProjection';

export interface SourceExecutionContextValue {
  profileId: string;
  config: SiteConfig | null;
}

export interface SourceExecutionResolverPort {
  forProfile(profileId?: string): SourceExecutionContextValue;
  forSource(context: SourceExecutionContextValue, key: string): SourceBean | null;
}

export interface SourceExecutionContextPort {
  activeProfileId(): string;
  activeConfig(): SiteConfig | null;
  findProfile(profileId: string): { id: string; apiUrl: string } | null;
  profileConfig(profileId: string): SiteConfig | null;
  activeSource(key: string): SourceBean | null;
}

/** Resolve profile-scoped source snapshots without switching global runtime state. */
export class SourceExecutionContext implements SourceExecutionResolverPort {
  constructor(private readonly port: SourceExecutionContextPort) {}

  forProfile(profileId?: string): SourceExecutionContextValue {
    const activeId = this.port.activeProfileId();
    const requestedId = profileId === undefined ? activeId : profileId;
    if (!requestedId) {
      if (profileId !== undefined && activeId) throw new Error('该来源档案已不可用，请从当前订阅重新打开');
      return { profileId: '', config: this.port.activeConfig() };
    }
    if (requestedId === activeId) return { profileId: requestedId, config: copyExecutionConfig(this.port.activeConfig()) };

    const profile = this.port.findProfile(requestedId);
    if (!profile) throw new Error(`订阅档案不存在：${requestedId}`);
    const parsed = this.port.profileConfig(requestedId);
    if (!parsed) throw new Error(`订阅档案不存在：${requestedId}`);
    const base = profile.apiUrl || '';
    const config: SiteConfig = {
      ...parsed,
      sites: base ? parsed.sites.map((source) => normalizeSourcePaths(source, base)) : parsed.sites,
      spider: base ? resolveRelativeValue(parsed.spider, base) : parsed.spider,
    };
    return { profileId: requestedId, config: copyExecutionConfig(config) };
  }

  forSource(context: SourceExecutionContextValue, key: string): SourceBean | null {
    const source = context.config?.sites.find((item) => item.key === key);
    return source ? { ...source, runtimeScope: JSON.stringify([context.profileId, key]) } : null;
  }

  forRequest(key: string, profileId?: string): SourceBean | null {
    const activeId = this.port.activeProfileId();
    const requestedId = profileId === undefined ? activeId : profileId;
    if (requestedId === activeId) {
      const source = this.port.activeSource(key);
      return source ? { ...source, runtimeScope: JSON.stringify([requestedId, key]) } : null;
    }
    return this.forSource(this.forProfile(profileId), key);
  }
}

function copyExecutionConfig(config: SiteConfig | null): SiteConfig | null {
  if (!config) return null;
  return {
    ...config,
    sites: config.sites.map((source) => ({
      ...source,
      categories: source.categories ? [...source.categories] : source.categories,
    })),
    parses: config.parses.map((parse) => ({ ...parse })),
    lives: config.lives.map((live) => ({ ...live, header: live.header ? { ...live.header } : undefined })),
    flags: [...config.flags],
  };
}
