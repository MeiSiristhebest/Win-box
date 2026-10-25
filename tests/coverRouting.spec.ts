import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';

vi.mock('electron', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-host-'));
  return { app: { getPath: () => dir, isPackaged: false }, nativeImage: {}, safeStorage: { isEncryptionAvailable: () => false } };
});
vi.mock('../src/main/meta/tmdbProvider', async () => ({
  ...await vi.importActual<any>('../src/main/meta/tmdbProvider'),
  tmdbSearchTitle: vi.fn(), tmdbImages: vi.fn(),
}));
vi.mock('../src/main/meta/doubanProvider', async () => ({
  ...await vi.importActual<any>('../src/main/meta/doubanProvider'), doubanSearchTitle: vi.fn(),
}));
vi.mock('../src/main/meta/so360Provider', async () => ({
  ...await vi.importActual<any>('../src/main/meta/so360Provider'), so360SearchCover: vi.fn(),
}));
import { app } from 'electron';
import { createMetadataServiceIntegrationFixture } from './spiderHostIntegrationFixture';
import { tmdbSearchTitle } from '../src/main/meta/tmdbProvider';
import { doubanSearchTitle } from '../src/main/meta/doubanProvider';
import { so360SearchCover } from '../src/main/meta/so360Provider';

const db = { title: '影片', year: 2025, type: 'movie' as const, poster: 'douban', overview: '' };
afterAll(() => rmSync(app.getPath('userData'), { recursive: true, force: true }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tmdbSearchTitle).mockResolvedValue(null);
  vi.mocked(doubanSearchTitle).mockResolvedValue(db);
});

describe('封面 IPC 路由不再使用图片搜索（模拟测试）', () => {
  it('旧 search 策略不会搜封面或读取旧搜索缓存；无凭据不调用 TMDB', async () => {
    const metadata = createMetadataServiceIntegrationFixture();
    metadata.setSettings({ tmdbApiKey: '', metaSource: 'search' });
    const get = vi.spyOn((metadata as any).dependencies.cache, 'get');
    expect(await metadata.search('封面路由一', '2025')).toEqual(db);
    expect(tmdbSearchTitle).not.toHaveBeenCalled();
    expect(so360SearchCover).not.toHaveBeenCalled();
    expect(get.mock.calls.every(([key]) => String(key).startsWith('db:cover-v2:'))).toBe(true);
  });
  it('调用方可单独查 TMDB，未命中时先留给源图，不直接查豆瓣', async () => {
    const metadata = createMetadataServiceIntegrationFixture();
    metadata.setSettings({ tmdbApiKey: 'fixture', metaSource: 'douban' });
    expect(await metadata.search('封面路由二', '2025', 'tmdb')).toBeNull();
    expect(tmdbSearchTitle).toHaveBeenCalledTimes(1);
    expect(doubanSearchTitle).not.toHaveBeenCalled();
    expect(await metadata.search('封面路由二', '2025', 'douban')).toEqual(db);
    expect(tmdbSearchTitle).toHaveBeenCalledTimes(1);
    expect(doubanSearchTitle).toHaveBeenCalledWith(expect.anything(), '封面路由二', '2025');
  });
  it('海报兼容入口也不搜图；背景图搜索保留且 TMDB 失败能回退', async () => {
    const metadata = createMetadataServiceIntegrationFixture();
    metadata.setSettings({ tmdbApiKey: 'fixture' });
    vi.mocked(tmdbSearchTitle).mockRejectedValue(Error('offline'));
    const artwork = { images: vi.fn(async () => ({ backdrops: ['background'], posters: [] })) };
    (metadata as any).dependencies.artwork.images = artwork.images;
    expect(await metadata.discoverImages('封面路由三', 'movie', '2025', 'poster')).toEqual({ backdrops: [], posters: ['douban'] });
    expect(artwork.images).not.toHaveBeenCalled();
    expect(await metadata.discoverImages('封面路由三', 'movie', '2025')).toEqual({ backdrops: ['background'], posters: [] });
    expect(artwork.images).toHaveBeenCalledOnce();
    expect(so360SearchCover).not.toHaveBeenCalled();
  });
});
