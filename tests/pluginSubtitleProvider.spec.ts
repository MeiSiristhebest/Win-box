// tests/pluginSubtitleProvider.spec.ts — 插件字幕源适配层（L2 声明式：URL 模板 + JSON 路径）：
//   宿主按声明**代发请求**并取数（本文件把 http 桩掉，只验证「拼出的 URL / 取到的候选 / 下载解码」）。
//   覆盖：模板展开 → 候选映射 / 非 JSON 与 list 非数组的可读报错 / fetch 解码 / 关闭开关。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubtitleProviderContribute } from '../src/shared/plugin';
import type { SubtitleSearchContext } from '../src/main/subtitle/provider';
import type { SubtitleSettings } from '../src/shared/subtitle';

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

const { subtitleProviderFromContribute } = await import('../src/main/plugin/pluginSubtitleProvider');

const CONTRIBUTE: SubtitleProviderContribute = {
  type: 'subtitle.provider',
  id: 'my-subs',
  name: '我的字幕站',
  search: {
    url: 'https://sub.example.com/api/search?q={keyword}&ep={ep}',
    headers: { Referer: 'https://sub.example.com/' },
    list: 'data.list',
    map: { file: 'id', subname: 'filename', title: 'video_title', lang: 'language', format: 'ext' },
  },
  fetch: { url: 'https://sub.example.com/api/download/{file}', headers: { Referer: 'https://sub.example.com/' } },
};

const SETTINGS: SubtitleSettings = { enabled: true, fontSize: 20, bottom: 40, providers: {} };
const ctx = (over: Partial<SubtitleSearchContext> = {}): SubtitleSearchContext => ({
  title: '繁花',
  keywords: ['繁花 S01', '繁花'],
  ep: '12',
  settings: SETTINGS,
  ...over,
});

beforeEach(() => {
  probe.calls.length = 0;
  probe.bytes = null;
});

describe('插件字幕源 — 声明式检索', () => {
  it('按模板拼 URL（占位符百分号编码 + 自定义头）并映射候选', async () => {
    probe.bytes = Buffer.from(
      JSON.stringify({
        data: {
          list: [
            { id: 7, filename: '繁花.S01E12.ass', video_title: '繁花', language: '简中', ext: 'ass' },
            { id: 8, filename: '繁花.S01E12.cht.ass', language: '繁中' },
            { filename: '缺 id → 丢弃' },
          ],
        },
      }),
    );
    const p = subtitleProviderFromContribute(CONTRIBUTE);
    const list = await p.search(ctx());
    expect(probe.calls[0].url).toBe('https://sub.example.com/api/search?q=%E7%B9%81%E8%8A%B1%20S01&ep=12');
    expect(probe.calls[0].headers).toEqual({ Referer: 'https://sub.example.com/' });
    expect(list).toEqual([
      { file: '7', subname: '繁花.S01E12.ass', provider: 'my-subs', title: '繁花', lang: '简中', format: 'ass', detail: undefined },
      { file: '8', subname: '繁花.S01E12.cht.ass', provider: 'my-subs', title: undefined, lang: '繁中', format: undefined, detail: undefined },
    ]);
  });

  it('响应不是 JSON / list 不是数组 → 抛可读错误（由聚合层落到该源报告）', async () => {
    const p = subtitleProviderFromContribute(CONTRIBUTE);
    probe.bytes = Buffer.from('<html>waf</html>');
    await expect(p.search(ctx())).rejects.toThrow('响应不是合法 JSON');
    probe.bytes = Buffer.from(JSON.stringify({ data: { list: { a: 1 } } }));
    await expect(p.search(ctx())).rejects.toThrow('不是数组');
  });

  it('请求失败（null）→ 抛错', async () => {
    probe.bytes = null;
    await expect(subtitleProviderFromContribute(CONTRIBUTE).search(ctx())).rejects.toThrow('请求失败或响应超限');
  });
});

describe('插件字幕源 — 声明式下载', () => {
  it('按 {file} 拼下载 URL → 解码为字幕文本 + 真实文件名', async () => {
    probe.bytes = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nhello\n');
    const p = subtitleProviderFromContribute(CONTRIBUTE);
    const r = await p.fetch({ file: '7', subname: '繁花.S01E12.srt', provider: 'my-subs' }, ctx());
    expect(probe.calls[0].url).toBe('https://sub.example.com/api/download/7');
    expect(r.text).toContain('hello');
    expect(r.fileName).toBe('繁花.S01E12.srt');
    expect(r.format).toBe('srt');
  });

  it('下载失败（null）→ 给可读原因，不抛', async () => {
    probe.bytes = null;
    const r = await subtitleProviderFromContribute(CONTRIBUTE).fetch({ file: '7', subname: 'a.srt' }, ctx());
    expect(r.text).toBe('');
    expect(r.reason).toBe('字幕下载失败（地址失效或网络异常）');
  });
});

describe('插件字幕源 — 开关', () => {
  it('用户关掉该源 → available=false（不参与检索）', () => {
    const p = subtitleProviderFromContribute(CONTRIBUTE);
    expect(p.needsToken).toBe(false);
    expect(p.available(SETTINGS)).toEqual({ ok: true });
    expect(p.available({ ...SETTINGS, providers: { 'my-subs': false } }))
      .toEqual({ ok: false, reason: '已在字幕设置中关闭' });
  });
});
