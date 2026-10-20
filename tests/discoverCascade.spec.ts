// tests/discoverCascade.spec.ts — 级联分类（豆瓣数据层）的纯函数测试（★ 2026-10-15）。
// 覆盖：recommend 响应解析（丢榜单条目 / 封面中继 / 年份抽取）、豆瓣自带词表解析、
//       查询串拼装（「全部」不下发）、年代 tag → 年份区间、内置快照字典形状。
import { describe, expect, it } from 'vitest';
import { buildExploreUrl, parseDoubanExplore, parseDoubanVocab, yearFromCardSubtitle } from '../src/main/meta/doubanExplore';
import {
  ALL_TAG, BUILTIN_VOCAB, DISCOVER_MEDIA, discoverYearValues, DOUBAN_SORTS, LOCAL_SORTS,
  MOVIE_GENRES, MOVIE_REGIONS, TV_REGIONS, TV_SUBTYPES, applyLocalFilters, localDimensions,
  localMatch, sortLocal, yearTagRange,
} from '../src/shared/discover';

const movieItem = (over: Record<string, unknown> = {}) => ({
  id: 26752088, title: '我不是药神', type: 'movie', card_subtitle: '2018 / 文牧野 / 徐峥',
  pic: { large: 'https://qnmob3.doubanio.com/view/photo/l/public/p1.jpg' }, ...over,
});
const chartItem = { id: 123, title: '高分经典喜剧片榜', type: 'chart', uri: 'douban://douban.com/subject_collection/mov' };

describe('yearFromCardSubtitle', () => {
  it('取副标题里的首个 4 位年份', () => {
    expect(yearFromCardSubtitle('2018 / 文牧野 / 徐峥')).toBe(2018);
    expect(yearFromCardSubtitle('2010-07-16 / 克里斯托弗·诺兰')).toBe(2010);
    expect(yearFromCardSubtitle('暂无年份')).toBe('');
    expect(yearFromCardSubtitle('')).toBe('');
  });
});

describe('parseDoubanExplore', () => {
  it('只留影片条目：榜单/豆列（type=chart）被丢掉', () => {
    const r = parseDoubanExplore({ items: [chartItem, movieItem()] }, 'movie');
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('我不是药神');
  });

  it('封面走本地 /img 中继；年份来自 card_subtitle；带 doubanId', () => {
    const r = parseDoubanExplore({ items: [movieItem()] }, 'movie');
    expect(r[0].poster).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/img\?u=/);
    expect(decodeURIComponent(r[0].poster.split('u=')[1])).toBe('https://qnmob3.doubanio.com/view/photo/l/public/p1.jpg');
    expect(r[0].year).toBe(2018);
    expect(r[0].doubanId).toBe('26752088');
    expect(r[0].mediaType).toBe('movie');
  });

  it('媒体类型不符 / 无标题 / 无封面 / 重复 id 的条目跳过', () => {
    const r = parseDoubanExplore(
      { items: [movieItem({ type: 'tv' }), movieItem({ id: 2, title: '' }), movieItem({ id: 3, pic: {} }), movieItem(), movieItem()] },
      'movie',
    );
    expect(r).toHaveLength(1);
  });

  it('异常输入安全返回空数组', () => {
    expect(parseDoubanExplore(null, 'movie')).toEqual([]);
    expect(parseDoubanExplore({ items: 'x' }, 'movie')).toEqual([]);
  });

  it('tv 媒体只留 type=tv 的条目', () => {
    const tv = { id: 1, title: '漫长的季节', type: 'tv', card_subtitle: '2023 / 辛爽', pic: { normal: 'https://img1.doubanio.com/a.jpg' } };
    const r = parseDoubanExplore({ items: [movieItem(), tv] }, 'tv');
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('漫长的季节');
    expect(r[0].year).toBe(2023);
  });
});

describe('parseDoubanVocab', () => {
  const resp = {
    recommend_categories: [
      { type: '类型', data: [{ text: '全部' }, { text: '喜剧' }, { text: '动作' }] },
      { type: '地区', data: [{ text: '全部' }, { text: '中国大陆' }, { text: '美国' }] },
    ],
    sorts: [{ name: 'T', text: '综合排序', checked: true }, { name: 'S', text: '高分优先', checked: false }],
  };

  it('电影：类型 + 地区 取豆瓣词表，年代用我们补的一套', () => {
    const v = parseDoubanVocab(resp, 'movie');
    expect(v.dimensions.map((d) => d.key)).toEqual(['类型', '地区', '年代']);
    expect(v.dimensions[0].values[0]).toBe(ALL_TAG);
    expect(v.dimensions[0].values).toContain('喜剧');
    expect(v.dimensions[1].values).toContain('中国大陆');
    expect(v.dimensions[2].values).toContain('2010年代');
    expect(v.sorts.map((s) => s.id)).toEqual(['T', 'S']);
    expect(v.defaultSort).toBe('T');
  });

  it('剧集：豆瓣 tv 的「类型」只有 电视剧/综艺（= 我们的一级分类）→ 改用更细的剧集子类', () => {
    const v = parseDoubanVocab({ recommend_categories: [{ type: '类型', data: [{ text: '类型' }, { text: '电视剧' }, { text: '综艺' }] }, { type: '地区', data: [{ text: '全部' }, { text: '美国' }] }], sorts: [] }, 'tv');
    expect(v.dimensions[0].values).toEqual([ALL_TAG, ...TV_SUBTYPES]);
    expect(v.dimensions[0].values).not.toContain('电视剧');
  });

  it('豆瓣没给词表/排序 → 回退内置快照', () => {
    const v = parseDoubanVocab({}, 'movie');
    expect(v.dimensions[0].values).toEqual([ALL_TAG, ...MOVIE_GENRES]);
    expect(v.sorts).toEqual(DOUBAN_SORTS);
    expect(v.defaultSort).toBe('T');
  });
});

describe('buildExploreUrl', () => {
  it('「全部」不下发；多维度用逗号连接；start/count/sort 就位', () => {
    const url = new URL(buildExploreUrl('movie', { mediaType: 'movie', tags: ['电影', ALL_TAG, '喜剧', '中国大陆'], sort: 'S', start: 40, count: 20 }));
    expect(url.pathname).toBe('/rexxar/api/v2/movie/recommend');
    expect(url.searchParams.get('tags')).toBe('电影,喜剧,中国大陆');
    expect(url.searchParams.get('sort')).toBe('S');
    expect(url.searchParams.get('start')).toBe('40');
    expect(url.searchParams.get('count')).toBe('20');
  });

  it('tags 全为「全部」→ tags 为空串；start 负数/超界被 clamp', () => {
    const u1 = new URL(buildExploreUrl('tv', { mediaType: 'tv', tags: [ALL_TAG] }));
    expect(u1.searchParams.get('tags')).toBe('');
    expect(new URL(buildExploreUrl('tv', { mediaType: 'tv', tags: [], start: -5 })).searchParams.get('start')).toBe('0');
    expect(new URL(buildExploreUrl('tv', { mediaType: 'tv', tags: [], start: 9999 })).searchParams.get('start')).toBe('500');
  });

  it('剧集走 /tv/recommend', () => {
    expect(buildExploreUrl('tv', { mediaType: 'tv', tags: [] })).toContain('/tv/recommend?');
  });
});

describe('yearTagRange', () => {
  it('单年 / N0年代 / 两位年代 / 更早 / 全部', () => {
    expect(yearTagRange('2024')).toEqual({ from: 2024, to: 2024 });
    expect(yearTagRange('2010年代')).toEqual({ from: 2010, to: 2019 });
    expect(yearTagRange('90年代')).toEqual({ from: 1990, to: 1999 });
    expect(yearTagRange('80年代')).toEqual({ from: 1980, to: 1989 });
    expect(yearTagRange('更早')).toEqual({ from: 0, to: 1979 });
    expect(yearTagRange(ALL_TAG)).toBeNull();
    expect(yearTagRange('')).toBeNull();
  });
});

describe('选项字典', () => {
  it('分类包含五类，媒体类型与固定 tag 正确', () => {
    expect(DISCOVER_MEDIA.map((m) => m.id)).toEqual(['movie', 'tv', 'variety', 'animation', 'documentary']);
    expect(DISCOVER_MEDIA.find((m) => m.id === 'tv')?.baseTag).toBe('电视剧');
    expect(DISCOVER_MEDIA.find((m) => m.id === 'variety')?.baseTag).toBe('综艺');
    expect(DISCOVER_MEDIA.find((m) => m.id === 'movie')?.baseTag).toBe('电影');
  });

  it('年代选项：首项「全部」，含近 12 年与年代桶（豆瓣可下发）', () => {
    const vals = discoverYearValues(new Date('2026-10-15T00:00:00'));
    expect(vals[0]).toBe(ALL_TAG);
    expect(vals).toEqual(expect.arrayContaining(['2026', '2015', '2010年代', '2000年代', '90年代', '80年代', '更早']));
  });

  it('内置快照：两套维度的值与快照表一致且无重复', () => {
    expect(BUILTIN_VOCAB.source).toBe('builtin');
    expect(BUILTIN_VOCAB.movie.dimensions[0].values).toEqual([ALL_TAG, ...MOVIE_GENRES]);
    expect(BUILTIN_VOCAB.movie.dimensions[1].values).toEqual([ALL_TAG, ...MOVIE_REGIONS]);
    expect(BUILTIN_VOCAB.tv.dimensions[1].values).toEqual([ALL_TAG, ...TV_REGIONS]);
    for (const v of [BUILTIN_VOCAB.movie, BUILTIN_VOCAB.tv]) {
      for (const d of v.dimensions) expect(new Set(d.values).size).toBe(d.values.length);
      expect(v.sorts).toEqual(DOUBAN_SORTS);
    }
  });
});

// ★ 2026-10-15（用户要求「点播页分类要和发现页一样丰富」）：源没有对应筛选组时的**本地过滤**口径
describe('点播页本地维度（源缺失该筛选组时）', () => {
  it('localDimensions 给出 类型/地区/年代 三维，选项都够多且首项是「全部」', () => {
    const dims = localDimensions();
    expect(dims.map((d) => d.key)).toEqual(['类型', '地区', '年代']);
    for (const d of dims) {
      expect(d.values[0]).toBe(ALL_TAG);
      expect(new Set(d.values).size).toBe(d.values.length);
    }
    expect(dims[0].values.length).toBeGreaterThan(20); // 豆瓣电影类型 + 剧集子类
    expect(dims[1].values.length).toBeGreaterThan(20);
  });

  it('本地排序三选项', () => {
    expect(LOCAL_SORTS.map((s) => s.id)).toEqual(['default', 'year', 'name']);
  });

  it('localMatch：类型靠「包含」命中（源常写「喜剧片」），并支持别名', () => {
    expect(localMatch('类型', '喜剧', '喜剧片')).toBe(true);
    expect(localMatch('类型', '喜剧', '爱情片')).toBe(false);
    expect(localMatch('类型', '动画', '动漫')).toBe(true);
    expect(localMatch('类型', '科幻', '科幻片')).toBe(true);
    expect(localMatch('类型', '动作', '')).toBe(false);
  });

  it('localMatch：地区支持别名（中国大陆 ↔ 大陆/内地；华语 ↔ 香港/台湾）', () => {
    expect(localMatch('地区', '中国大陆', '大陆')).toBe(true);
    expect(localMatch('地区', '中国大陆', '内地')).toBe(true);
    expect(localMatch('地区', '华语', '香港')).toBe(true);
    expect(localMatch('地区', '美国', '美')).toBe(true);
    expect(localMatch('地区', '美国', '日本')).toBe(false);
    expect(localMatch('地区', '欧美', '法国')).toBe(true);
  });

  it('localMatch：年代走年份区间（单年 / N0年代 / 更早）', () => {
    expect(localMatch('年代', '2024', '2024')).toBe(true);
    expect(localMatch('年代', '2024', '2023')).toBe(false);
    expect(localMatch('年代', '2024', '2024-05-01')).toBe(true);
    expect(localMatch('年代', '2010年代', '2015')).toBe(true);
    expect(localMatch('年代', '2010年代', '2009')).toBe(false);
    expect(localMatch('年代', '更早', '1972')).toBe(true);
    expect(localMatch('年代', '更早', '1990')).toBe(false);
  });

  it('applyLocalFilters：多维度 AND；「全部」不参与；空选择原样返回', () => {
    const items = [
      { name: 'A', type: '喜剧片', area: '大陆', year: '2018' },
      { name: 'B', type: '喜剧片', area: '美国', year: '2018' },
      { name: 'C', type: '动作片', area: '大陆', year: '2018' },
      { name: 'D', type: '喜剧片', area: '大陆', year: '1999' },
    ];
    expect(applyLocalFilters(items, {})).toHaveLength(4);
    expect(applyLocalFilters(items, { 类型: ALL_TAG, 地区: ALL_TAG })).toHaveLength(4);
    expect(applyLocalFilters(items, { 类型: '喜剧', 地区: '中国大陆' }).map((i) => i.name)).toEqual(['A', 'D']);
    expect(applyLocalFilters(items, { 类型: '喜剧', 地区: '中国大陆', 年代: '2010年代' }).map((i) => i.name)).toEqual(['A']);
    expect(applyLocalFilters(items, { 类型: '喜剧', 地区: '美国' }).map((i) => i.name)).toEqual(['B']);
  });

  it('sortLocal：按年份新→旧；按片名按中文拼音序；默认保持原序', () => {
    const items = [{ name: '乙', year: '2001' }, { name: '甲', year: '2020' }, { name: '丙', year: '' }];
    expect(sortLocal(items, 'year').map((i) => i.name)).toEqual(['甲', '乙', '丙']); // 无年份的排最后
    // 拼音序：丙(bing) < 甲(jia) < 乙(yi)
    expect(sortLocal(items, 'name').map((i) => i.name)).toEqual(['丙', '甲', '乙']);
    expect(sortLocal(items, 'default').map((i) => i.name)).toEqual(['乙', '甲', '丙']);
  });
});
