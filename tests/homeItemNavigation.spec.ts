import { describe, expect, it, vi } from 'vitest';
import type { SourceBean, VodItem } from '../src/shared/types';
import { resolveHomeItemNavigation } from '../src/renderer/features/home/application/homeItemNavigation';

function source(key: string, name: string, api: string): SourceBean {
  return {
    key, name, type: 1, api, searchable: 1, quickSearch: 1, changeable: 1,
    filterable: 1, playUrl: '', ext: '', jar: '', playerType: -1,
    categories: null, timeout: 15, click: '', style: '',
  };
}

function item(overrides: Partial<VodItem> = {}): VodItem {
  return {
    id: 'movie-1', name: '示例电影', pic: 'https://image.test/poster.jpg',
    remarks: '', year: '2025', area: '', type: '电影', sourceKey: 'source-a',
    ...overrides,
  };
}

describe('resolveHomeItemNavigation', () => {
  it('routes folder items to category expansion without loading source metadata', async () => {
    const sourceLookup = { loadProfileSources: vi.fn(async () => []) };
    await expect(resolveHomeItemNavigation({
      item: item({ tag: 'folder', sourceRef: { profileId: 'profile-b', key: 'drive-b' } }),
      currentProfileId: 'profile-a', currentSources: [],
    }, sourceLookup)).resolves.toEqual({
      kind: 'folder', sourceKey: 'drive-b', profileId: 'profile-b', id: 'movie-1', name: '示例电影',
    });
    expect(sourceLookup.loadProfileSources).not.toHaveBeenCalled();
  });

  it('opens a normal detail using the item profile and source identity', async () => {
    const sourceLookup = { loadProfileSources: vi.fn(async () => []) };
    await expect(resolveHomeItemNavigation({
      item: item({ sourceRef: { profileId: 'profile-b', key: 'source-b' } }),
      currentProfileId: 'profile-a', currentSources: [],
    }, sourceLookup)).resolves.toEqual({
      kind: 'detail', sourceKey: 'source-b', profileId: 'profile-b',
      id: 'movie-1', poster: 'https://image.test/poster.jpg', name: '示例电影',
    });
    expect(sourceLookup.loadProfileSources).toHaveBeenCalledWith('profile-b');
  });

  it('routes recommendation-source items to metadata details', async () => {
    const sourceLookup = { loadProfileSources: vi.fn(async () => []) };
    const action = await resolveHomeItemNavigation({
      item: item({ sourceKey: 'douban-feed', type: '电视剧' }),
      currentProfileId: 'profile-a',
      currentSources: [source('douban-feed', '豆瓣推荐', 'https://api.test/douban')],
    }, sourceLookup);
    expect(action).toEqual({
      kind: 'recommendation',
      route: '/movie?name=%E7%A4%BA%E4%BE%8B%E7%94%B5%E5%BD%B1&type=tv&year=2025&pic=https%3A%2F%2Fimage.test%2Fposter.jpg',
    });
    expect(sourceLookup.loadProfileSources).not.toHaveBeenCalled();
  });

  it('falls back to source-identity detail navigation when another profile cannot be loaded', async () => {
    const sourceLookup = { loadProfileSources: vi.fn(async () => { throw new Error('profile unavailable'); }) };
    await expect(resolveHomeItemNavigation({
      item: item({ sourceRef: { profileId: 'profile-b', key: 'source-b' } }),
      currentProfileId: 'profile-a', currentSources: [],
    }, sourceLookup)).resolves.toMatchObject({ kind: 'detail', sourceKey: 'source-b', profileId: 'profile-b' });
  });
});
