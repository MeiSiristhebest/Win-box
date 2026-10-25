import { describe, expect, it, vi } from 'vitest';
import type { SourceQueryGatewayPort } from '../src/engine/vod/SourcePorts';
import type { SourceBean, VodDetail, VodItem } from '../src/shared/types';
import { SourceCatalogApplicationService } from '../src/main/spider/SourceCatalogApplicationService';
import type { SourceExecutionResolverPort } from '../src/main/spider/SourceExecutionContext';

const source = { key: 'catalog-source', name: 'Catalog source' } as SourceBean;
const item = { id: 'movie-1', name: 'Example', sourceKey: source.key } as VodItem;
const detail = {
  id: 'movie-1', name: 'Example', pic: '', type: '', year: '', area: '', director: '', actor: '', des: '', remarks: '', flags: [], episodes: {},
} satisfies VodDetail;

function createService() {
  const execution: SourceExecutionResolverPort = {
    forProfile: (profileId) => ({ profileId: profileId ?? 'active-profile', config: null }),
    forSource: (_context, key) => key === source.key ? source : null,
  };
  const gateway: SourceQueryGatewayPort = {
    home: async () => ({ sourceKey: source.key, sortClasses: [], items: [item], page: 1, pagecount: 1, total: 1 }),
    category: async () => ({ sourceKey: source.key, sortClasses: [], items: [item], page: 1, pagecount: 1, total: 1 }),
    detail: async () => detail,
    search: async () => [item],
  };
  const detailLoaded = vi.fn();
  return { service: new SourceCatalogApplicationService({ execution, gateway, detailLoaded }), detailLoaded };
}

describe('SourceCatalogApplicationService', () => {
  it('resolves a profile-scoped source and annotates catalog results with that profile', async () => {
    const { service } = createService();

    const result = await service.home(source.key, 'archived-profile');

    expect(result.items[0]?.sourceRef).toEqual({ profileId: 'archived-profile', key: source.key });
  });

  it('notifies the host after decorating detail, so optional drive learning stays outside the query use case', async () => {
    const { service, detailLoaded } = createService();

    const result = await service.detail(source.key, ['movie-1'], 'archived-profile');

    expect(result?.sourceRef).toEqual({ profileId: 'archived-profile', key: source.key });
    expect(detailLoaded).toHaveBeenCalledWith(source, 'archived-profile', result);
  });

  it('rejects unknown sources before calling the gateway', async () => {
    const { service } = createService();

    await expect(service.search('missing-source', 'Example')).rejects.toThrow('源不存在: missing-source');
  });
});
