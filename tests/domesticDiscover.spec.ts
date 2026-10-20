import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DomesticDiscover, parseDomesticItems, parseBaiduMovieHot } from '../src/main/meta/domesticDiscover';
import { JsonStore } from '../src/main/store/JsonStore';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
const log = { d: vi.fn(), i: vi.fn(), w: vi.fn(), e: vi.fn() };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'domestic-discover-'));
  dirs.push(dir);
  return new JsonStore(join(dir, 'cache.json'));
}
const douban = { total: 45, items: [
  { id: '123', title: '流浪地球', type: 'movie', year: '2019', pic: { large: 'https://img3.doubanio.com/poster.jpg' } },
  { title: '科幻榜', type: 'chart', cover_url: 'https://img3.doubanio.com/chart.jpg' },
] };
const hot = { success: true, data: { cards: [{ content: [{ content: [
  { title: '电影乙', index: 2, hotScore: { value: '9000' } },
  { title: '电影甲', index: 1, hotScore: { value: '10000' } },
  { title: '导航' },
] }] }] } };

describe('国内发现页数据契约', () => {
  it('兼容 pic/cover，排除榜单卡与非影片，保留无封面影片待补全', () => {
    expect(parseDomesticItems(douban, 'movie')).toHaveLength(1);
    expect(parseDomesticItems(douban, 'movie')[0]).toMatchObject({ title: '流浪地球', year: 2019, doubanId: '123', mediaType: 'movie' });
    const result = parseDomesticItems({ subject_collection_items: [{ type: 'tv', title: '狂飙', cover: { url: 'https://img3.doubanio.com/p.jpg' } }, { type: 'tv', title: '无图剧集' }] }, 'tv');
    expect(result).toHaveLength(2);
    expect(result[0].poster).toContain('/img?');
    expect(result[1].poster).toBe('');
    expect(parseDomesticItems(null, 'movie')).toEqual([]);
  });

  it('电影热搜按真实 index 排序，保留指数，不混入导航、新闻', () => {
    expect(parseBaiduMovieHot(hot)).toEqual([{ title: '电影甲', rank: 1, score: '10000' }, { title: '电影乙', rank: 2, score: '9000' }]);
    expect(parseBaiduMovieHot({ ...hot, success: false })).toEqual([]);
    expect(parseBaiduMovieHot(null)).toEqual([]);
  });

  it('榜单与热搜分别缓存，分类不使用 TMDB 的类型 ID', async () => {
    const fetcher = vi.fn(async (url: string) => url.includes('top.baidu.com') ? hot : douban);
    const provider = new DomesticDiscover(fixture(), log, fetcher);
    const hotResult = await provider.hot();
    expect(hotResult.items[0].rank).toBe(1);
    expect(hotResult.stale).toBe(false);
    expect(await provider.discover()).toHaveLength(3); // fixture 仅提供电影，剧集响应被过滤
    const genres = provider.genres();
    const sciFi = genres.movie.find(g => g.name === '科幻')!;
    const page = await provider.genrePage('movie', sciFi.id, 2);
    expect(page).toMatchObject({ page: 2, totalPages: 3 });
    expect(fetcher.mock.calls.some(([url]) => url.includes('tags=%E7%A7%91%E5%B9%BB') && url.includes('start=20'))).toBe(true);
    expect(fetcher.mock.calls.every(([url]) => !url.includes('themoviedb'))).toBe(true);
  });

  it('不缓存总数大于零但解析结果为空的榜单首屏', async () => {
    const store = fixture();
    const fetcher = vi.fn(async () => ({ total: 12, subject_collection_items: [] }));
    const provider = new DomesticDiscover(store, log, fetcher);
    await expect(provider.boardPage('movie_top250', 1)).rejects.toThrow('暂时无法读取榜单');
    expect(store.getObject('board:movie_top250:1', null)).toBeNull();
  });

  it('重启后读磁盘缓存，过期数据立即显示，后台失败不覆盖成功结果', async () => {
    const store = fixture();
    const first = new DomesticDiscover(store, log, vi.fn(async () => hot));
    const initial = await first.hot();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 3600000);
    const fail = vi.fn(async () => { throw new Error('network'); });
    const restarted = new DomesticDiscover(new JsonStore(store.filePath), log, fail);
    const result = await restarted.hot();
    expect(result.items).toEqual(initial.items);
    expect(result.stale).toBe(true);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(store.getObject<any>('movie-hot', null).value).toEqual(initial.items);
  });

  it('合并并发冷启动请求，失败后短时退避而非循环请求', async () => {
    const fetcher = vi.fn(async () => { throw new Error('blocked'); });
    const provider = new DomesticDiscover(fixture(), log, fetcher);
    await Promise.all([provider.hot(), provider.hot()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await provider.hot()).items).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('连续三次风控后熔断同站点，暂停余下分区，不影响百度榜单', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('baidu.com')) return hot;
      throw Object.assign(new Error('forbidden'), { status: 403 });
    });
    const provider = new DomesticDiscover(fixture(), log, fetcher);
    expect(await provider.discover()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await provider.hot()).items).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
