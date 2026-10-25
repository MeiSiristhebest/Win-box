import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';

vi.mock('electron', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-host-'));
  return { app: { getPath: () => dir, isPackaged: false }, nativeImage: {}, safeStorage: { isEncryptionAvailable: () => false } };
});
vi.mock('../src/main/meta/tmdbProvider', async () => ({
  ...await vi.importActual<any>('../src/main/meta/tmdbProvider'),
  tmdbDiscover: vi.fn(async () => [{ id: 'tmdb', title: 'TMDB', items: [] }]),
  tmdbGenres: vi.fn(async () => ({ movie: [{ id: 878, name: '科幻' }], tv: [] })),
  tmdbGenrePage: vi.fn(async () => ({ items: [], page: 2, totalPages: 3 })),
}));
import { app } from 'electron';
import { createMetadataServiceIntegrationFixture } from './spiderHostIntegrationFixture';
import { tmdbDiscover, tmdbGenres, tmdbGenrePage } from '../src/main/meta/tmdbProvider';

afterAll(() => { rmSync(app.getPath('userData'), { recursive: true, force: true }); });
beforeEach(() => vi.clearAllMocks());

describe('发现页来源分派', () => {
  it('默认国内榜单，保存用户 Key 后使用 TMDB，清空后恢复国内榜单；热搜始终独立', async () => {
    const metadata = createMetadataServiceIntegrationFixture();
    const domestic = { discover: vi.fn(async () => [{ id: 'domestic', title: '国内榜单', items: [] }]),
      genres: vi.fn(() => ({ movie: [{ id: 5, name: '科幻' }], tv: [] })),
      genrePage: vi.fn(async () => ({ items: [], page: 1, totalPages: 1 })), hot: vi.fn(async () => ({ source: 'baidu', items: [] })) };
    (metadata as any).dependencies.domestic = domestic;
    metadata.setSettings({ tmdbApiKey: '', metaSource: 'auto' });
    expect(metadata.getSettings()).toMatchObject({ hasBuiltin: false, hasUserKey: false });
    expect((await metadata.discover())[0].id).toBe('domestic');
    expect((await metadata.genres()).movie[0].id).toBe(5);
    await metadata.genrePage('movie', 5, 1);
    expect(tmdbDiscover).not.toHaveBeenCalled();
    expect(tmdbGenres).not.toHaveBeenCalled();
    expect(tmdbGenrePage).not.toHaveBeenCalled();
    metadata.setSettings({ tmdbApiKey: 'fixture-key' });
    expect(metadata.getSettings()).toMatchObject({ hasBuiltin: false, hasUserKey: true });
    expect((await metadata.discover())[0].id).toBe('tmdb');
    expect((await metadata.genres()).movie[0].id).toBe(878);
    await metadata.genrePage('movie', 878, 2);
    expect(tmdbGenrePage).toHaveBeenCalledWith(expect.anything(), 'movie', 878, 2);
    await metadata.movieHot();
    expect(domestic.hot).toHaveBeenCalledTimes(1);
    metadata.setSettings({ tmdbApiKey: '' });
    expect((await metadata.discover())[0].id).toBe('domestic');
    expect((await metadata.genres()).movie[0].id).toBe(5);
  });
});
