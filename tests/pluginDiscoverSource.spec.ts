// tests/pluginDiscoverSource.spec.ts — 插件发现页数据源适配层（L2 声明式）：
//   宿主按声明代发请求并取数（本文件把 http 桩掉，只验证「产出的分区与条目」）。
//   覆盖：多分区 / `{mediaType}` 展开 / 图片一律包 /img 中继（相对路径先拼 imageBase、已是中继不套两层、拼不出丢图） /
//         空列表与非法分区只跳过自己（不拖垮同插件其它分区）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LOCAL_PROXY_BASE } from '../src/shared/constants';
import type { DiscoverSourceContribute } from '../src/shared/plugin';

const probe = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; headers?: Record<string, string> }>,
  queue: [] as Array<Buffer | null>,
}));

vi.mock('../src/main/subtitle/http', () => ({
  getBuffer: async (url: string, opts: { headers?: Record<string, string> } = {}) => {
    probe.calls.push({ url, headers: opts.headers });
    return probe.queue.length ? probe.queue.shift()! : null;
  },
}));

const { discoverSourceFromContribute } = await import('../src/main/plugin/pluginDiscoverSource');

const relay = (u: string) => `${LOCAL_PROXY_BASE}/img?${new URLSearchParams({ u })}`;
const json = (o: unknown) => Buffer.from(JSON.stringify(o));

const CONTRIBUTE: DiscoverSourceContribute = {
  type: 'discover.source',
  id: 'my-discover',
  name: '我的榜单',
  sections: [
    {
      id: 'my-top-movie',
      title: '我的电影热榜',
      mediaType: 'movie',
      url: 'https://api.example.com/top?type={mediaType}&limit=20',
      headers: { Referer: 'https://api.example.com/' },
      list: 'data.items',
      imageBase: 'https://img.example.com/t/p/w342',
      map: { title: 'name', year: 'year', poster: 'poster_path', backdrop: 'wide_path', mediaType: 'type', tmdbId: 'tmdb_id' },
    },
    {
      id: 'my-top-tv',
      title: '我的剧集热榜',
      mediaType: 'tv',
      url: 'https://api.example.com/top?type={mediaType}',
      list: 'data.items',
      map: { title: 'name' },
    },
  ],
};

beforeEach(() => {
  probe.calls.length = 0;
  probe.queue.length = 0;
});

describe('插件发现页数据源 — 声明式取分区', () => {
  it('多分区：URL 按 mediaType 展开、条目映射、图片一律包 /img 中继', async () => {
    probe.queue.push(
      json({
        data: {
          items: [
            { name: '繁花', year: '2023', poster_path: '/a.jpg', wide_path: 'w/x.jpg', type: 'TV Series', tmdb_id: 12345 },
            { name: '', year: 2020 },
            { name: '无海报条目' },
          ],
        },
      }),
      json({ data: { items: [{ name: '剧集甲' }, { name: '剧集乙', name2: 1 }] } }),
    );
    const out = await discoverSourceFromContribute(CONTRIBUTE).sections();
    expect(probe.calls.map((c) => c.url)).toEqual([
      'https://api.example.com/top?type=movie&limit=20',
      'https://api.example.com/top?type=tv',
    ]);
    expect(probe.calls[0].headers).toEqual({ Referer: 'https://api.example.com/' });
    expect(out.map((s) => s.id)).toEqual(['my-top-movie', 'my-top-tv']);
    expect(out.map((s) => s.mediaType)).toEqual(['movie', 'tv']);
    expect(out[0].title).toBe('我的电影热榜');
    expect(out[0].items).toEqual([
      {
        title: '繁花',
        year: 2023,
        poster: relay('https://img.example.com/t/p/w342/a.jpg'),
        backdrop: relay('https://img.example.com/t/p/w342/w/x.jpg'),
        mediaType: 'tv',
        tmdbId: 12345,
      },
      { title: '无海报条目', year: '', poster: '', mediaType: 'movie' },
    ]);
    // 第二分区只声明 title：缺省 mediaType 取分区声明（tv），其它字段留空
    expect(out[1].items).toEqual([
      { title: '剧集甲', year: '', poster: '', mediaType: 'tv' },
      { title: '剧集乙', year: '', poster: '', mediaType: 'tv' },
    ]);
  });

  it('图片：已是中继地址不套两层；相对路径未配 imageBase 则丢图（不产坏图）', async () => {
    probe.queue.push(json({ data: { items: [{ name: 'A', poster_path: `${LOCAL_PROXY_BASE}/img?u=x` }] } }));
    const already = await discoverSourceFromContribute(CONTRIBUTE).sections();
    expect(already[0].items[0].poster).toBe(`${LOCAL_PROXY_BASE}/img?u=x`);

    probe.queue.push(json({ data: { items: [{ name: 'B', poster_path: 'rel/b.jpg' }] } }));
    const noBase: DiscoverSourceContribute = {
      ...CONTRIBUTE,
      sections: [{ ...CONTRIBUTE.sections[0], imageBase: undefined }],
    };
    const lost = await discoverSourceFromContribute(noBase).sections();
    expect(lost[0].items[0].poster).toBe('');
  });

  it('空列表 / 非数组 → 该分区不出现（不产空行）', async () => {
    probe.queue.push(json({ data: { items: [] } }), json({ data: { items: 'nope' } }));
    expect(await discoverSourceFromContribute(CONTRIBUTE).sections()).toEqual([]);
  });

  it('非法分区（非 JSON）只跳过自己，另一分区照常产出', async () => {
    probe.queue.push(Buffer.from('<html>waf</html>'), json({ data: { items: [{ name: '剧集甲' }] } }));
    const out = await discoverSourceFromContribute(CONTRIBUTE).sections();
    expect(out.map((s) => s.id)).toEqual(['my-top-tv']);
    expect(out[0].items[0].title).toBe('剧集甲');
  });
});
