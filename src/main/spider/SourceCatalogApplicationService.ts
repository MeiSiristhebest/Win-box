import type { CategoryResult, HomeResult, SourceQueryGatewayPort } from '../../engine/vod/SourcePorts';
import type { SourceBean, VodDetail, VodItem } from '../../shared/types';
import type { SourceExecutionResolverPort } from './SourceExecutionContext';

export interface SourceCatalogApplicationPorts {
  execution: SourceExecutionResolverPort;
  gateway: SourceQueryGatewayPort;
  detailLoaded?(source: SourceBean, profileId: string, detail: VodDetail | null): void;
}

/** Resolves profile-scoped source queries and adds the source identity required by the UI. */
export class SourceCatalogApplicationService {
  constructor(private readonly ports: SourceCatalogApplicationPorts) {}

  async home(key: string, profileId?: string): Promise<HomeResult> {
    const { context, source } = this.resolve(key, profileId);
    const result = await this.ports.gateway.home(source);
    return { ...result, items: result.items.map((item) => withSourceRef(item, context.profileId)) };
  }

  async category(key: string, tid: string, pg: string, extend: Record<string, string>, profileId?: string): Promise<CategoryResult> {
    const { context, source } = this.resolve(key, profileId);
    const result = await this.ports.gateway.category(source, tid, pg, extend);
    return { ...result, items: result.items.map((item) => withSourceRef(item, context.profileId)) };
  }

  async detail(key: string, ids: string[], profileId?: string): Promise<VodDetail | null> {
    const { context, source } = this.resolve(key, profileId);
    const detail = await this.ports.gateway.detail(source, ids);
    const result = detail ? { ...detail, sourceRef: { profileId: context.profileId, key } } : null;
    this.ports.detailLoaded?.(source, context.profileId, result);
    return result;
  }

  async search(key: string, keyword: string, profileId?: string): Promise<VodItem[]> {
    const { context, source } = this.resolve(key, profileId);
    const items = await this.ports.gateway.search(source, keyword);
    return items.map((item) => withSourceRef(item, context.profileId));
  }

  private resolve(key: string, profileId?: string) {
    const context = this.ports.execution.forProfile(profileId);
    const source = this.ports.execution.forSource(context, key);
    if (!source) throw new Error(`源不存在: ${key}`);
    return { context, source };
  }
}

function withSourceRef<T extends { sourceKey: string }>(item: T, profileId: string): T & { sourceRef: { profileId: string; key: string } } {
  return { ...item, sourceRef: { profileId, key: item.sourceKey } };
}
