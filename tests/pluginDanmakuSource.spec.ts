// tests/pluginDanmakuSource.spec.ts — 插件弹幕源适配层（L2 声明式：三步链路）：
//   ① search（关键词→番剧候选）② episodes（番剧→剧集候选）③ comment（剧集→弹幕 XML）。
//   覆盖：三段 URL 模板展开 / 候选映射（含 bangumiId 兜底与可选项）/ XML 校验 / 失败抛错（由宿主记冷却）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DanmakuSourceContribute } from '../src/shared/plugin';

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

const { danmakuSourceFromContribute } = await import('../src/main/plugin/pluginDanmakuSource');

const json = (o: unknown) => Buffer.from(JSON.stringify(o));

const CONTRIBUTE: DanmakuSourceContribute = {
  type: 'danmaku.source',
  id: 'my-danmaku',
  name: '我的弹幕站',
  search: {
    url: 'https://dm.example.com/api/search?keyword={keyword}&season={season}',
    headers: { Referer: 'https://dm.example.com/' },
    list: 'animes',
    map: { animeId: 'animeId', title: 'animeTitle', bangumiId: 'bangumiId', episodeCount: 'episodeCount', kind: 'type' },
  },
  episodes: {
    url: 'https://dm.example.com/api/bangumi/{animeId}',
    list: 'bangumi.episodes',
    map: { episodeId: 'episodeId', episodeTitle: 'episodeTitle', episodeNumber: 'episodeNumber' },
  },
  comments: { url: 'https://dm.example.com/api/comment/{episodeId}?format=xml' },
};

beforeEach(() => {
  probe.calls.length = 0;
  probe.queue.length = 0;
});

describe('插件弹幕源 — 三步链路', () => {
  const src = () => danmakuSourceFromContribute(CONTRIBUTE);

  it('① 搜索：URL 双占位符展开 + 番剧映射（bangumiId 兜底 animeId、可选字段按值给）', async () => {
    probe.queue.push(json({
      animes: [
        { animeId: 101, animeTitle: '繁花', bangumiId: 202, episodeCount: '30', type: 'tvseries' },
        { animeId: 303, animeTitle: '无双' },
        { animeId: 'x', animeTitle: '非法 id' },
        { animeId: 404 },
      ],
    }));
    const list = await src().search('繁花 S01', 1);
    expect(probe.calls[0].url).toBe('https://dm.example.com/api/search?keyword=%E7%B9%81%E8%8A%B1%20S01&season=1');
    expect(probe.calls[0].headers).toEqual({ Referer: 'https://dm.example.com/' });
    expect(list).toEqual([
      { animeId: 101, bangumiId: 202, title: '繁花', kind: 'tvseries', episodeCount: 30, source: 'plugin:my-danmaku', sourceName: '我的弹幕站' },
      { animeId: 303, bangumiId: 303, title: '无双', source: 'plugin:my-danmaku', sourceName: '我的弹幕站' },
    ]);
  });

  it('season 未传 → 展开为空串（不报错）', async () => {
    probe.queue.push(json({ animes: [{ animeId: 1, animeTitle: 'A' }] }));
    await src().search('A');
    expect(probe.calls[0].url).toBe('https://dm.example.com/api/search?keyword=A&season=');
  });

  it('② 剧集：URL 展开 {animeId} + 剧集映射（集号取数字串）', async () => {
    probe.queue.push(json({
      bangumi: {
        episodes: [
          { episodeId: 11, episodeTitle: '第 1 话', episodeNumber: '1' },
          { episodeId: '22', episodeTitle: '第 2 话' },
          { episodeTitle: '无 id → 丢弃' },
        ],
      },
    }));
    const list = await src().episodes(101, '繁花');
    expect(probe.calls[0].url).toBe('https://dm.example.com/api/bangumi/101');
    expect(list).toEqual([
      { episodeId: 11, source: 'plugin:my-danmaku', sourceName: '我的弹幕站', title: '繁花', episodeTitle: '第 1 话', episodeNumber: '1' },
      { episodeId: 22, source: 'plugin:my-danmaku', sourceName: '我的弹幕站', title: '繁花', episodeTitle: '第 2 话' },
    ]);
  });

  it('③ 弹幕：URL 展开 {episodeId} 并返回 XML 文本', async () => {
    probe.queue.push(Buffer.from('<i><d p="1.5,1,25,16777215">你好</d></i>'));
    const xml = await src().comment(11);
    expect(probe.calls[0].url).toBe('https://dm.example.com/api/comment/11?format=xml');
    expect(xml.startsWith('<')).toBe(true);
    expect(xml).toContain('你好');
  });

  it('失败路径：列表非数组抛错；弹幕非 XML 抛错；请求失败抛错', async () => {
    probe.queue.push(json({ animes: 'nope' }));
    await expect(src().search('A')).rejects.toThrow('不是数组');
    probe.queue.push(json({ bangumi: { episodes: {} } }));
    await expect(src().episodes(1)).rejects.toThrow('不是数组');
    probe.queue.push(Buffer.from('{"not":"xml"}'));
    await expect(src().comment(1)).rejects.toThrow('响应不是 XML');
    probe.queue.push(null);
    await expect(src().comment(1)).rejects.toThrow('请求失败或响应超限');
  });
});
