// tests/pluginLiveTemplate.spec.ts — 插件直播输出模板适配层（L2 声明式**输出**）：
//   把宿主**已解析**的 `LiveGroup[]` 按「每行格式串」格式化输出 TXT / M3U。
//   ★ 本类型**不发请求、不取数、不解析**（与前四个 provider 形态根本不同）。
// 覆盖：内置 txt / m3u 渲染 / 自定义模板 / 多线路展开 / 跳过空分组与空 urls / 行连接符与末尾补行 /
//   占位符原值替换（中文不编码）/ **自洽性**（内置 txt 产物能被既有 TxtSubscribe 解析回频道）。
import { describe, it, expect } from 'vitest';
import { builtinLiveTemplates, liveTemplateFromContribute } from '../src/main/plugin/pluginLiveTemplate';
import { LIVE_TEMPLATE_EOL, type LiveTemplateContribute } from '../src/shared/plugin';
import { parseToJsonArray, toLiveGroups } from '../src/engine/live/TxtSubscribe';
import type { LiveChannel, LiveGroup } from '../src/shared/types';

/** 造一个字段齐全的频道（LiveChannel 字段多，测试里只关系 name/urls/logo/tvg-*） */
function ch(name: string, urls: string[], over: Partial<LiveChannel> = {}): LiveChannel {
  return {
    name, urls, logo: '', epg: '', ua: '', click: '', format: '', origin: '', referer: '',
    'tvg-id': '', 'tvg-name': '', 'tvg-chno': '', ...over,
  };
}

const GROUPS: LiveGroup[] = [
  {
    group: '央视',
    channels: [
      ch('CCTV-1', ['http://a/1', 'http://b/1'], { logo: 'l1.png', 'tvg-id': 'cctv1', 'tvg-name': 'CCTV1', 'tvg-chno': '1' }),
      ch('CCTV-2', ['http://a/2']),
    ],
  },
  { group: '空组', channels: [] }, // 无频道 → 整组不输出
  {
    group: '卫视',
    channels: [
      ch('湖南卫视', []), // 无 urls → 该频道不输出
      ch('浙江卫视', ['http://c/zj']),
    ],
  },
];

const tpl = (id: string) => builtinLiveTemplates().find((t) => t.id === id)!;

describe('插件直播输出模板 — 内置模板渲染', () => {
  it('内置 2 个模板（txt / m3u），格式与扩展名对口径', () => {
    const list = builtinLiveTemplates();
    expect(list.map((t) => t.id)).toEqual(['builtin:txt', 'builtin:m3u']);
    expect(list.map((t) => [t.format, t.ext])).toEqual([['txt', 'txt'], ['m3u', 'm3u']]);
    expect(list.every((t) => t.pluginId === 'builtin')).toBe(true);
  });

  it('builtin:txt — 分组行 + 多线路各一行 + 跳过空分组/空 urls + CRLF 与末尾补行', () => {
    const out = tpl('builtin:txt').render(GROUPS, { liveName: '测试线路' });
    expect(out).toBe(
      [
        '央视,#genre#',
        'CCTV-1,http://a/1',
        'CCTV-1,http://b/1',
        'CCTV-2,http://a/2',
        '卫视,#genre#',
        '浙江卫视,http://c/zj',
        '',
      ].join(LIVE_TEMPLATE_EOL),
    );
    expect(out.endsWith(LIVE_TEMPLATE_EOL)).toBe(true);
    expect(out.includes('空组')).toBe(false); // 空分组不出现
    expect(out.includes('湖南卫视')).toBe(false); // 无 urls 的频道不出现
  });

  it('builtin:m3u — #EXTM3U 头 + EXTINF 与地址分两行 + tvg-* / group-title 展开', () => {
    const out = tpl('builtin:m3u').render(GROUPS, { liveName: 'x' });
    expect(out.startsWith(`#EXTM3U${LIVE_TEMPLATE_EOL}`)).toBe(true);
    expect(out).toContain(
      '#EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV1" tvg-logo="l1.png" group-title="央视",CCTV-1',
    );
    // EXTINF 行的下一行必须是地址（两行结构）
    expect(out).toContain(`group-title="央视",CCTV-1${LIVE_TEMPLATE_EOL}http://a/1`);
    expect(out).toContain('group-title="卫视",浙江卫视');
  });

  it('空分组集 → 仅剩文件头（m3u 至少 #EXTM3U；txt 为空串）', () => {
    expect(tpl('builtin:m3u').render([], { liveName: 'x' })).toBe(`#EXTM3U${LIVE_TEMPLATE_EOL}`);
    expect(tpl('builtin:txt').render([], { liveName: 'x' })).toBe('');
  });
});

describe('插件直播输出模板 — 自定义模板', () => {
  const CUSTOM: LiveTemplateContribute = {
    type: 'live.template',
    id: 'my-pipe',
    label: '竖线格式',
    format: 'txt',
    group: '== {group} ==',
    line: '{index} | {name} | {url}',
  };

  it('自定义分组行 / 频道行 + {index} 按**频道**计数（同频道多线路共用同一序号）', () => {
    const out = liveTemplateFromContribute(CUSTOM).render(GROUPS, { liveName: 'x' });
    expect(out).toBe(
      [
        '== 央视 ==',
        '1 | CCTV-1 | http://a/1',
        '1 | CCTV-1 | http://b/1',
        '2 | CCTV-2 | http://a/2',
        '== 卫视 ==',
        '1 | 浙江卫视 | http://c/zj',
        '',
      ].join(LIVE_TEMPLATE_EOL),
    );
  });

  it('占位符是**原值替换**（中文名与地址不做百分号编码）+ pluginId 占位', () => {
    const out = liveTemplateFromContribute(CUSTOM).render(
      [{ group: '央视', channels: [ch('CCTV-1 综合', ['http://x/中文?q=甲'])] }],
      { liveName: 'x' },
    );
    expect(out).toContain('CCTV-1 综合');
    expect(out).toContain('http://x/中文?q=甲');
    expect(out).not.toContain('%E4%B8%AD');
    expect(liveTemplateFromContribute(CUSTOM).pluginId).toBe('plugin'); // 真实 id 由 PluginHost 覆盖
    expect(liveTemplateFromContribute(CUSTOM).ext).toBe('txt'); // ext 缺省按 format
  });
});

describe('插件直播输出模板 — 与既有解析器自洽（★ 只读调用，不改解析器）', () => {
  it('builtin:txt 的产物能被 TxtSubscribe 解析回分组与频道', () => {
    const out = tpl('builtin:txt').render(GROUPS, { liveName: 'x' });
    const groups = toLiveGroups(parseToJsonArray(out));
    expect(groups.map((g) => g.group)).toEqual(['央视', '卫视']);
    const cctv = groups[0].channels.find((c) => c.name === 'CCTV-1');
    expect(cctv?.urls).toEqual(['http://a/1', 'http://b/1']);
    expect(groups[1].channels.map((c) => c.name)).toEqual(['浙江卫视']);
  });
});
