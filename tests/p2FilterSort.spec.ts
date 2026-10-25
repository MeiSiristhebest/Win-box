// tests/p2FilterSort.spec.ts — 五项 P2：filters 解析、extend 转义、sessionSort
import { describe, it, expect } from 'vitest';
import { normalizeClassList, parseSortJson } from '../src/engine/parse/Movie';
import { JarSpider } from '../src/engine/spider/JarSpider';
import type { EngineHost } from '../src/engine/ports';
import type { JarSpiderRuntimePort } from '../src/engine/spider/JarSpiderPorts';
import { NullLogger } from '../src/engine/util/logger';
import { getSessionSort, setSessionSort, clearSessionSort } from '../src/renderer/lib/sessionSort';

describe('parseSortJson — class[].filters 解析', () => {
  it('把 filters（{key:{name,value:[{tab,n,v}]}}）归一成 FilterGroup[]', () => {
    const json = JSON.stringify({
      class: [
        {
          type_id: '1',
          type_name: '电影',
          filters: {
            area: { name: '地区', value: [{ tab: '全部', n: '全部', v: '' }, { n: '中国', v: 'cn' }, { n: '美国', v: 'us' }] },
          },
        },
      ],
    });
    const [c] = parseSortJson(json);
    expect(c.id).toBe('1');
    expect(c.filters).toBeDefined();
    expect(c.filters!.length).toBe(1);
    const g = c.filters![0];
    expect(g.key).toBe('area');
    expect(g.name).toBe('地区');
    expect(g.value.map((o) => o.v)).toEqual(['', 'cn', 'us']);
    expect(g.value[0].n).toBe('全部');
  });

  it('无 filters → 不带 filters 字段（对象形状与历史一致）', () => {
    const [c] = parseSortJson(JSON.stringify({ class: [{ type_id: '1', type_name: '电影' }] }));
    expect('filters' in c).toBe(false);
  });

  // ★★ 2026-10-15（用户报「你还是没拿到源的分类」）：真源的 filters 形态 —— 顶层按 type_id 键控 + **组是数组**
  //   样本取自真实 drpy 源（txsp）homeContent 原文（见日志 / .tmp/cat-probe3-result.json）。
  it('真源形态：顶层 filters[type_id] = [{key,name,value}]（数组）→ 解析出 类型/地区/年份/排序', () => {
    const json = JSON.stringify({
      class: [
        { type_id: 'movie', type_name: '电影' },
        { type_id: 'tv', type_name: '电视剧' },
      ],
      filters: {
        movie: [
          { key: 'sort', name: '排序', value: [{ n: '最热', v: '75' }, { n: '最新', v: '83' }] },
          { key: 'itype', name: '类型', value: [{ n: '类型', v: '-1' }, { n: '动作', v: '4' }, { n: '喜剧', v: '3' }] },
          { key: 'iarea', name: '地区', value: [{ n: '地区', v: '-1' }, { n: '内地', v: '100024' }] },
          { key: 'iyear', name: '年份', value: [{ n: '年份', v: '-1' }, { n: '2024', v: '2024' }] },
        ],
      },
      list: [],
    });
    const [c1, c2] = parseSortJson(json);
    expect(c1.filters!.map((g) => g.key)).toEqual(['sort', 'itype', 'iarea', 'iyear']);
    expect(c1.filters!.map((g) => g.name)).toEqual(['排序', '类型', '地区', '年份']);
    expect(c1.filters![1].value.map((o) => [o.n, o.v])).toEqual([['类型', '-1'], ['动作', '4'], ['喜剧', '3']]);
    expect('filters' in c2).toBe(false); // 只有 movie 有筛选组 → 别的分类不硬塞
  });

  it('数组组缺 key 时回退下标；空 value 组被剔除', () => {
    const json = JSON.stringify({
      class: [{ type_id: '1', type_name: '电影' }],
      filters: { 1: [{ name: '无名组', value: [{ n: 'A', v: 'a' }] }, { key: 'x', name: '空组', value: [] }] },
    });
    const [c] = parseSortJson(json);
    expect(c.filters!.map((g) => [g.key, g.name])).toEqual([['0', '无名组']]);
  });

  it('对象 map 形态仍兼容（历史 mock / 部分源）', () => {
    const json = JSON.stringify({
      class: [{ type_id: '1', type_name: '电影' }],
      filters: {
        1: {
          class: { name: '类型', value: [{ n: '全部', v: '' }, { n: '动作', v: '动作' }] },
          area: { name: '地区', value: [{ n: '全部', v: '' }, { n: '大陆', v: '大陆' }] },
        },
      },
    });
    const [c] = parseSortJson(json);
    expect(c.filters!.map((g) => g.key)).toEqual(['class', 'area']);
    expect(c.filters![0].value.map((o) => o.v)).toEqual(['', '动作']);
  });

  it('顶层 filters 用下标键控（键不是 type_id）→ 也能命中', () => {
    const json = JSON.stringify({
      class: [{ type_id: 'movie', type_name: '电影' }, { type_id: 'tv', type_name: '电视剧' }],
      filters: { 0: [{ key: 'itype', name: '类型', value: [{ n: '动作', v: '4' }] }], 1: [{ key: 'itype', name: '类型', value: [{ n: '爱情', v: '5' }] }] },
    });
    const [c0, c1] = parseSortJson(json);
    expect(c0.filters![0].value[0]).toMatchObject({ n: '动作', v: '4' });
    expect(c1.filters![0].value[0]).toMatchObject({ n: '爱情', v: '5' });
  });

  it('顶层 filters 是「通用组 map」（不对分类键控）→ 每个分类都用它', () => {
    const json = JSON.stringify({
      class: [{ type_id: 'a', type_name: '电影' }, { type_id: 'b', type_name: '剧集' }],
      filters: { area: { key: 'area', name: '地区', value: [{ n: '内地', v: '1' }] }, year: { key: 'year', name: '年份', value: [{ n: '2024', v: '2024' }] } },
    });
    const [c1, c2] = parseSortJson(json);
    expect(c1.filters!.map((g) => g.name)).toEqual(['地区', '年份']);
    expect(c2.filters!.map((g) => g.key)).toEqual(['area', 'year']);
  });

  it('选项字段别名（name/value、values 数组）→ 也能取到 n/v', () => {
    const json = JSON.stringify({
      class: [{ type_id: '1', type_name: '电影' }],
      filters: { 1: [{ key: 'itype', name: '类型', values: [{ name: '动作', value: '4' }] }] },
    });
    const [c] = parseSortJson(json);
    expect(c.filters![0].value[0]).toMatchObject({ n: '动作', v: '4' });
  });

  it('分类字段别名：id/tid + type_name/name/title', () => {
    const json = JSON.stringify({ class: [{ tid: '9', title: '纪录片' }] });
    const [c] = parseSortJson(json);
    expect([c.id, c.name]).toEqual(['9', '纪录片']);
  });

  it('内嵌 filters 优先，其次才回退顶层（两种形态都写了也不重复）', () => {
    const json = JSON.stringify({
      class: [{ type_id: '1', type_name: '电影', filters: { inner: { name: '内嵌', value: [{ n: 'A', v: 'a' }] } } }],
      filters: { 1: { outer: { name: '顶层', value: [{ n: 'B', v: 'b' }] } } },
    });
    const [c] = parseSortJson(json);
    expect(c.filters!.map((g) => g.key)).toEqual(['inner']);
  });

  // ★ 2026-10-15（用户报「有的源应该有分类，但点播页没有分类」）：class 形态兜底
  describe('class 形态兜底（normalizeClassList）', () => {
    it('标准数组 → 原样（非对象元素丢弃）', () => {
      expect(normalizeClassList([{ type_id: '1', type_name: '电影' }])).toEqual([{ type_id: '1', type_name: '电影' }]);
      expect(normalizeClassList([{ type_id: '1' }, '电影', 3, null])).toEqual([{ type_id: '1' }]);
    });

    it('对象 map {"1":"电影"} → 键当 id、值当名称（不再整段丢弃）', () => {
      const [c1, c2] = parseSortJson(JSON.stringify({ class: { 1: '电影', 2: '剧集' } }));
      expect([c1.id, c1.name, c2.id, c2.name]).toEqual(['1', '电影', '2', '剧集']);
    });

    it('对象 map 的值为对象 → 键兜底 id、条目自带字段优先', () => {
      const [c1, c2] = parseSortJson(JSON.stringify({ class: { a: { name: '短剧' }, b: { type_id: 'b9', type_name: '综艺' } } }));
      expect([c1.id, c1.name]).toEqual(['a', '短剧']);
      expect([c2.id, c2.name]).toEqual(['b9', '综艺']);
    });

    it('非对象/空 → 空数组（不抛）', () => {
      expect(normalizeClassList(null)).toEqual([]);
      expect(normalizeClassList('电影')).toEqual([]);
      expect(normalizeClassList(undefined)).toEqual([]);
      expect(parseSortJson(JSON.stringify({ class: '电影' }))).toEqual([]);
    });
  });

  it('v 缺失时回退 n；空 value 分组被过滤', () => {
    const [c] = parseSortJson(
      JSON.stringify({
        class: [
          {
            type_id: '1',
            type_name: '电影',
            filters: {
              a: { value: [{ n: 'X', v: 'x' }] },
              empty: { value: [] },
            },
          },
        ],
      }),
    );
    expect(c.filters!.length).toBe(1); // empty 组被滤掉
    expect(c.filters![0].value[0]).toMatchObject({ n: 'X', v: 'x' });
  });
});

describe('JarSpider.categoryContent — extend kv 转义', () => {
  function makeHost(): EngineHost {
    return { http: {}, kv: {}, logger: NullLogger, driveTokens: () => ({}) } as unknown as EngineHost;
  }
  function recordingBridge(calls: { method: string; args: string[] }[]) {
    return {
      defaultJar: 'https://cdn/x.jar',
      ensureConverted: async () => '/tmp/j.jar',
      resolvePaths: (u: string[]) => u,
      call: async (_j: string[], _c: string, method: string, args: string[]) => {
        calls.push({ method, args });
        return { ok: true, output: '', reason: '', failureKind: null, problemCode: null };
      },
    } as unknown as JarSpiderRuntimePort;
  }

  it('值含 & = 空格 中文 → 百分号编码后再拼 kv，SpiderRunner 不会错切', async () => {
    const calls: { method: string; args: string[] }[] = [];
    const sp = new JarSpider(
      { key: 'k', api: 'csp_X', ext: '', jar: 'https://cdn/x.jar', host: makeHost() },
      recordingBridge(calls),
    );
    await sp.categoryContent('1', '1', true, { area: '中国&美=国 剧' });
    const kv = calls[0].args[3];
    expect(kv).toBe('area=' + encodeURIComponent('中国&美=国 剧'));
    // 确认不含裸 &（否则 split 会错切）
    expect(kv).not.toContain('中国');
    expect(decodeURIComponent(kv.split('=')[1])).toBe('中国&美=国 剧');
  });
});

describe('sessionSort — 会话内分类/筛选记忆', () => {
  it('set 后 get 回读（按 sourceKey::tid 区分）', () => {
    clearSessionSort();
    setSessionSort('s1', '2', { filter: { area: 'cn' }, pg: 3 });
    expect(getSessionSort('s1', '2')).toEqual({ filter: { area: 'cn' }, pg: 3 });
    expect(getSessionSort('s1', '3')).toBeUndefined();
    expect(getSessionSort('s2', '2')).toBeUndefined();
  });
  it('tid 为空不记忆', () => {
    clearSessionSort();
    setSessionSort('s1', '', { filter: {}, pg: 1 });
    expect(getSessionSort('s1', '')).toBeUndefined();
  });
});