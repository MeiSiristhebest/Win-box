// tests/pluginMetaProvider.spec.ts — 插件元数据源适配层（L2 声明式：URL 模板 + JSON 路径）：
//   宿主按声明代发请求并取数（本文件把 http 桩掉，只验证「取到的 MetaHit」）。
//   覆盖：数组/单对象两种响应形态 / imageBase 相对路径拼接 / 绝对 URL 原样 / 类型归一 /
//         取不到必需字段 → null / 非 JSON 抛错。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetaProviderContribute } from '../src/shared/plugin';

const probe = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; headers?: Record<string, string> }>,
  bytes: null as Buffer | null,
}));

vi.mock('../src/main/subtitle/http', () => ({
  getBuffer: async (url: string, opts: { headers?: Record<string, string> } = {}) => {
    probe.calls.push({ url, headers: opts.headers });
    return probe.bytes;
  },
}));

const { metaProviderFromContribute } = await import('../src/main/plugin/pluginMetaProvider');

const CONTRIBUTE: MetaProviderContribute = {
  type: 'meta.provider',
  id: 'my-meta',
  name: '我的元数据站',
  imageBase: 'https://img.example.com/t/p/w342',
  search: {
    url: 'https://api.example.com/search?q={keyword}&year={year}',
    headers: { Referer: 'https://api.example.com/' },
    list: 'data.results',
    map: { title: 'name', year: 'year', poster: 'poster_path', backdrop: 'wide_path', overview: 'overview', mediaType: 'type' },
  },
};

const json = (o: unknown) => Buffer.from(JSON.stringify(o));

beforeEach(() => {
  probe.calls.length = 0;
  probe.bytes = null;
});

describe('插件元数据源 — 声明式检索', () => {
  it('数组响应取第一项；相对图拼 imageBase；类型归一为 tv', async () => {
    probe.bytes = json({
      data: {
        results: [
          { name: '繁花', year: '2023', poster_path: '/abc.jpg', wide_path: 'wide/x.jpg', overview: '上海滩往事', type: 'TV Series' },
          { name: '不该被取到的第二条' },
        ],
      },
    });
    const hit = await metaProviderFromContribute(CONTRIBUTE).search({ title: '繁花', year: '2023' });
    expect(probe.calls[0].url).toBe('https://api.example.com/search?q=%E7%B9%81%E8%8A%B1&year=2023');
    expect(probe.calls[0].headers).toEqual({ Referer: 'https://api.example.com/' });
    expect(hit).toEqual({
      title: '繁花',
      year: 2023,
      poster: 'https://img.example.com/t/p/w342/abc.jpg',
      backdrop: 'https://img.example.com/t/p/w342/wide/x.jpg',
      overview: '上海滩往事',
      type: 'tv',
    });
  });

  it('单对象响应直接用（不走数组）', async () => {
    probe.bytes = json({ data: { item: { name: '独行月球', year: 2022, poster_path: 'https://cdn.x/y.jpg', type: 'movie' } } });
    const c: MetaProviderContribute = { ...CONTRIBUTE, search: { ...CONTRIBUTE.search, list: 'data.item' } };
    const hit = await metaProviderFromContribute(c).search({ title: '独行月球' });
    expect(hit).toMatchObject({ title: '独行月球', year: 2022, poster: 'https://cdn.x/y.jpg', type: 'movie', overview: '' });
    expect(hit?.backdrop).toBeUndefined();
  });

  it('相对图但未声明 imageBase → 海报置空（不产出坏图）', async () => {
    probe.bytes = json({ data: { results: [{ name: 'X', poster_path: '/abc.jpg' }] } });
    const c: MetaProviderContribute = { type: 'meta.provider', id: 'my-meta', name: 'n', search: CONTRIBUTE.search };
    const hit = await metaProviderFromContribute(c).search({ title: 'X' });
    expect(hit).toMatchObject({ title: 'X', poster: '', overview: '', type: 'movie' });
  });

  it('无命中（空数组 / 非对象 / 缺 title）→ null', async () => {
    const p = metaProviderFromContribute(CONTRIBUTE);
    probe.bytes = json({ data: { results: [] } });
    expect(await p.search({ title: 'X' })).toBeNull();
    probe.bytes = json({ data: { results: [{ year: 2020 }] } });
    expect(await p.search({ title: 'X' })).toBeNull();
    probe.bytes = json({ data: { results: 'nope' } });
    expect(await p.search({ title: 'X' })).toBeNull();
  });

  it('年份非数字 → 空串；非 JSON → 抛可读错误；请求失败 → 抛错', async () => {
    probe.bytes = json({ data: { results: [{ name: 'X', year: 'N/A' }] } });
    expect((await metaProviderFromContribute(CONTRIBUTE).search({ title: 'X' }))?.year).toBe('');
    probe.bytes = Buffer.from('<html>waf</html>');
    await expect(metaProviderFromContribute(CONTRIBUTE).search({ title: 'X' })).rejects.toThrow('响应不是合法 JSON');
    probe.bytes = null;
    await expect(metaProviderFromContribute(CONTRIBUTE).search({ title: 'X' })).rejects.toThrow('请求失败或响应超限');
  });
});
