// tests/pluginHost.spec.ts — 插件宿主（临时目录 + 真 zip）：
//   随包 builtin **物化**到 pluginsDir（方案 A：与用户安装同构 + 侧签）/ user 安装不被覆盖 /
//   安装·卸载·启停 / 超分档位 → 着色器**绝对路径**解析 / 未就绪一律 off。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip } from '../src/engine/util/syncZip';
import { HOST_API_VERSION, type PluginManifest } from '../src/shared/plugin';
import { PluginHost } from '../src/main/plugin/PluginHost';
import type { PluginSandboxOptions, SandboxLike } from '../src/main/plugin/sandbox/PluginSandbox';
import type { PluginSandboxApi } from '../src/main/plugin/sandbox/protocol';

let root: string;
let pluginsDir: string;
let builtinDir: string;
let statePath: string;

const SHADERS: Record<string, string[]> = {
  efficiency: ['a.glsl', 'b.glsl'],
  quality: ['c.glsl'],
};

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: 'super-resolution',
    name: '超分辨率',
    version: '1.0.0',
    apiVersion: HOST_API_VERSION,
    kind: 'asset',
    permissions: [],
    contributes: [
      {
        type: 'mpv.shaders',
        modes: Object.entries(SHADERS).map(([id, shaders]) => ({ id, label: id === 'efficiency' ? '效率档' : '质量档', shaders })),
      },
    ],
    ...over,
  };
}

/** 构造一个真实的 .winbox zip（plugin.json + files/ 下全部着色器） */
function winbox(m: PluginManifest): Buffer {
  const files: Array<{ name: string; bytes: Buffer }> = [
    { name: 'plugin.json', bytes: Buffer.from(JSON.stringify(m)) },
  ];
  for (const list of Object.values(SHADERS)) {
    for (const s of list) files.push({ name: `files/${s}`, bytes: Buffer.from(`// ${s}`) });
  }
  return buildZip(files);
}

function writeBuiltin(m: PluginManifest): void {
  mkdirSync(builtinDir, { recursive: true });
  writeFileSync(join(builtinDir, `${m.id}.winbox`), winbox(m));
}

function host(): PluginHost {
  return new PluginHost({ pluginsDir, builtinDir, statePath });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'winbox-host-'));
  pluginsDir = join(root, 'plugins');
  builtinDir = join(root, 'resources', 'plugins');
  statePath = join(root, 'plugins-state.json');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('PluginHost — 随包 builtin 物化（方案 A）', () => {
  it('init 把随包 zip 解到 pluginsDir/<id>.winbox/ 并写侧签；列表登记为 builtin 且就位', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    const dir = join(pluginsDir, 'super-resolution.winbox');
    expect(existsSync(join(dir, 'plugin.json'))).toBe(true);
    expect(existsSync(join(dir, 'files', 'a.glsl'))).toBe(true);
    expect(existsSync(join(dir, '.builtin.json'))).toBe(true);
    const items = await h.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'super-resolution', source: 'builtin', level: 'L1', enabled: true, ready: true });
    expect(items[0].modes.map((m) => m.id)).toEqual(['efficiency', 'quality']);
  });

  it('随包版本变化 → 重新物化（覆盖旧目录）', async () => {
    writeBuiltin(manifest({ version: '1.0.0' }));
    const h1 = host();
    await h1.init();
    const dir = join(pluginsDir, 'super-resolution.winbox');
    writeFileSync(join(dir, 'stale.txt'), 'old');
    // 软件更新：随包 zip 升到 2.0.0
    writeBuiltin(manifest({ version: '2.0.0' }));
    const h2 = host();
    await h2.init();
    expect(existsSync(join(dir, 'stale.txt'))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf-8')).version).toBe('2.0.0');
    expect((await h2.list())[0].version).toBe('2.0.0');
  });

  it('用户自己的同 id 安装（无侧签）→ 不被随包物化覆盖', async () => {
    // 先由"用户"装一份 9.9.9
    const h1 = host();
    await h1.installFromFile(writeTemp(manifest({ version: '9.9.9' })));
    // 再让随包出现同 id（1.0.0）
    writeBuiltin(manifest({ version: '1.0.0' }));
    const h2 = host();
    await h2.init();
    const items = await h2.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'user', version: '9.9.9' });
  });
});

describe('PluginHost — 安装 / 卸载 / 启停', () => {
  it('installFromFile 装用户插件（source=user），卸载删目录', async () => {
    const h = host();
    const r = await h.installFromFile(writeTemp(manifest()));
    expect(r.ok).toBe(true);
    expect(r.items?.[0]).toMatchObject({ source: 'user', ready: true });
    expect(existsSync(join(pluginsDir, 'super-resolution.winbox'))).toBe(true);
    const un = await h.uninstall('super-resolution');
    expect(un.ok).toBe(true);
    expect(existsSync(join(pluginsDir, 'super-resolution.winbox'))).toBe(false);
  });

  it('安装坏包 → ok=false 且给出可读原因，不落盘', async () => {
    const bad = join(root, 'bad.winbox');
    writeFileSync(bad, Buffer.from('not an archive'));
    const r = await host().installFromFile(bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(existsSync(pluginsDir)).toBe(false);
  });

  it('启停持久化：新实例读回同一状态', async () => {
    writeBuiltin(manifest());
    const h1 = host();
    await h1.init();
    await h1.setEnabled('super-resolution', false);
    expect((await h1.list())[0].enabled).toBe(false);
    const h2 = host();
    await h2.init();
    expect((await h2.list())[0].enabled).toBe(false);
  });
});

describe('PluginHost — 超分着色器解析', () => {
  it('档位 → files/ 下的**绝对路径**（顺序保持）', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    const dir = join(pluginsDir, 'super-resolution.winbox');
    expect(await h.srShaders('efficiency')).toEqual([join(dir, 'files', 'a.glsl'), join(dir, 'files', 'b.glsl')]);
    expect(await h.srShaders('quality')).toEqual([join(dir, 'files', 'c.glsl')]);
  });

  it('off / 非法档位 / 未装插件 → 空数组', async () => {
    const none = host();
    await none.init();
    expect(await none.srShaders('efficiency')).toEqual([]);
    expect(await none.srState('efficiency')).toEqual({ available: false, modes: [], mode: 'off' });

    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.srShaders('off')).toEqual([]);
    expect(await h.srShaders('nope')).toEqual([]);
  });

  it('停用后 → 视作未就绪（srShaders 空、srState.mode=off）', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    await h.setEnabled('super-resolution', false);
    expect(await h.srShaders('efficiency')).toEqual([]);
    expect(await h.srState('efficiency')).toMatchObject({ available: false, mode: 'off' });
  });

  it('srState：可用档位随插件声明；生效档位按 usable 收敛', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.srState('quality')).toMatchObject({ available: true, mode: 'quality' });
    expect((await h.srState('quality')).modes.map((m) => m.label)).toEqual(['效率档', '质量档']);
    expect(await h.srState('general')).toMatchObject({ mode: 'off' }); // 插件没这档 → off
  });

  it('着色器文件缺失 → 不返回不存在的路径', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    rmSync(join(pluginsDir, 'super-resolution.winbox', 'files', 'b.glsl'));
    expect(await h.srShaders('efficiency')).toEqual([join(pluginsDir, 'super-resolution.winbox', 'files', 'a.glsl')]);
  });
});

/** 把 .winbox 写到临时文件并返回路径 */
function writeTemp(m: PluginManifest): string {
  const p = join(root, `${m.id}-${m.version}.winbox`);
  writeFileSync(p, winbox(m));
  return p;
}

describe('PluginHost — 插件皮肤（contributes.theme）', () => {
  const themeManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'sakura-skin',
      name: '樱花皮肤',
      contributes: [
        {
          type: 'theme', id: 'sakura', label: '🌸 樱花', base: 'dark',
          tokens: { '--accent': '#e879a6', '--surface-0': '#120d12' },
          layout: { nav: 'top', density: 'comfy' },
        },
      ],
      ...over,
    });

  it('声明 theme 且已启用 → 返回 plugin:<skinId> + 令牌 + layout', async () => {
    writeBuiltin(themeManifest());
    const h = host();
    await h.init();
    expect(await h.themeSkins()).toEqual([
      {
        id: 'plugin:sakura',
        pluginId: 'sakura-skin',
        label: '🌸 樱花',
        base: 'dark',
        tokens: { '--accent': '#e879a6', '--surface-0': '#120d12' },
        layout: { nav: 'top', density: 'comfy' },
      },
    ]);
  });

  it('停用 → 不参与皮肤列表', async () => {
    writeBuiltin(themeManifest());
    const h = host();
    await h.init();
    await h.setEnabled('sakura-skin', false);
    expect(await h.themeSkins()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无皮肤', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.themeSkins()).toEqual([]);
  });

  it('磁盘清单被篡改（词表外令牌）→ 跳过装配（内容级兜底）', async () => {
    writeBuiltin(themeManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'sakura-skin.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<{ tokens: Record<string, string> }> };
    m.contributes[0].tokens = { '--nf-red': '#e50914' };
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.themeSkins()).toEqual([]);
  });
});

describe('PluginHost — 插件字幕源（contributes.subtitle.provider）', () => {
  const subManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-sub-source',
      name: '我的字幕源',
      contributes: [
        {
          type: 'subtitle.provider',
          id: 'my-subs',
          name: '我的字幕站',
          search: {
            url: 'https://sub.example.com/api/search?q={keyword}',
            list: 'data.list',
            map: { file: 'id', subname: 'filename' },
          },
          fetch: { url: 'https://sub.example.com/api/download/{file}' },
        },
      ],
      ...over,
    });

  it('声明 subtitle.provider 且已启用 → 暴露为宿主字幕源（id/name 一致）', async () => {
    writeBuiltin(subManifest());
    const h = host();
    await h.init();
    const list = await h.subtitleProviders();
    expect(list.map((p) => p.id)).toEqual(['my-subs']);
    expect(list[0].name).toBe('我的字幕站');
    expect((await h.list())[0].level).toBe('L2');
    expect(list[0].available({ enabled: true, fontSize: 20, bottom: 40 })).toEqual({ ok: true });
  });

  it('停用 → 不参与字幕源列表', async () => {
    writeBuiltin(subManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-sub-source', false);
    expect(await h.subtitleProviders()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无字幕源', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.subtitleProviders()).toEqual([]);
  });

  it('磁盘清单被篡改（占用内置源 id）→ 跳过装配（内容级兜底）', async () => {
    writeBuiltin(subManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'my-sub-source.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<{ id: string }> };
    m.contributes[0].id = 'assrt';
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.subtitleProviders()).toEqual([]);
  });
});

describe('PluginHost — 插件元数据源（contributes.meta.provider）', () => {
  const metaManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-meta-source',
      name: '我的元数据源',
      contributes: [
        {
          type: 'meta.provider',
          id: 'my-meta',
          name: '我的元数据站',
          imageBase: 'https://img.example.com/t/p/w342',
          search: {
            url: 'https://api.example.com/search?q={keyword}',
            list: 'data.results',
            map: { title: 'name', year: 'year', poster: 'poster_path' },
          },
        },
      ],
      ...over,
    });

  it('声明 meta.provider 且已启用 → 暴露为宿主元数据源', async () => {
    writeBuiltin(metaManifest());
    const h = host();
    await h.init();
    const list = await h.metaProviders();
    expect(list.map((p) => p.id)).toEqual(['my-meta']);
    expect(list[0].name).toBe('我的元数据站');
    expect((await h.list())[0].level).toBe('L2');
  });

  it('停用 → 不参与元数据源列表', async () => {
    writeBuiltin(metaManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-meta-source', false);
    expect(await h.metaProviders()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无元数据源', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.metaProviders()).toEqual([]);
  });

  it('磁盘清单被篡改（占用内置来源 id）→ 跳过装配（内容级兜底）', async () => {
    writeBuiltin(metaManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'my-meta-source.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<{ id: string }> };
    m.contributes[0].id = 'tmdb';
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.metaProviders()).toEqual([]);
  });
});

describe('PluginHost — 插件发现页数据源（contributes.discover.source）', () => {
  const discManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-discover-source',
      name: '我的发现页数据源',
      contributes: [
        {
          type: 'discover.source',
          id: 'my-discover',
          name: '我的榜单',
          sections: [
            {
              id: 'my-top-movie',
              title: '我的电影热榜',
              mediaType: 'movie',
              url: 'https://api.example.com/top?type={mediaType}',
              list: 'data.items',
              map: { title: 'name' },
            },
          ],
        },
      ],
      ...over,
    });

  it('声明 discover.source 且已启用 → 暴露为宿主发现页数据源', async () => {
    writeBuiltin(discManifest());
    const h = host();
    await h.init();
    const list = await h.discoverSources();
    expect(list.map((p) => p.id)).toEqual(['my-discover']);
    expect(list[0].name).toBe('我的榜单');
    expect((await h.list())[0].level).toBe('L2');
  });

  it('停用 → 不参与发现页数据源列表', async () => {
    writeBuiltin(discManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-discover-source', false);
    expect(await h.discoverSources()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无发现页数据源', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.discoverSources()).toEqual([]);
  });

  it('磁盘清单被篡改（sections 非法）→ 跳过装配（内容级兜底）', async () => {
    writeBuiltin(discManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'my-discover-source.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<{ sections: unknown[] }> };
    m.contributes[0].sections = [];
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.discoverSources()).toEqual([]);
  });
});

describe('PluginHost — 插件弹幕源（contributes.danmaku.source，三步链路）', () => {
  const dmManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-danmaku-source',
      name: '我的弹幕源',
      contributes: [
        {
          type: 'danmaku.source',
          id: 'my-danmaku',
          name: '我的弹幕站',
          search: { url: 'https://dm.example.com/s?keyword={keyword}', list: 'animes', map: { animeId: 'id', title: 'title' } },
          episodes: { url: 'https://dm.example.com/b/{animeId}', list: 'eps', map: { episodeId: 'id' } },
          comments: { url: 'https://dm.example.com/c/{episodeId}' },
        },
      ],
      ...over,
    });

  it('声明 danmaku.source 且已启用 → 暴露为宿主弹幕源（合成键 plugin:<id>）', async () => {
    writeBuiltin(dmManifest());
    const h = host();
    await h.init();
    const list = await h.danmakuSources();
    expect(list.map((p) => p.key)).toEqual(['plugin:my-danmaku']);
    expect(list[0].name).toBe('我的弹幕站');
    expect((await h.list())[0].level).toBe('L2');
  });

  it('停用 → 不参与弹幕源列表', async () => {
    writeBuiltin(dmManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-danmaku-source', false);
    expect(await h.danmakuSources()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无弹幕源', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.danmakuSources()).toEqual([]);
  });

  it('磁盘清单被篡改（comments 缺 {episodeId}）→ 跳过装配（内容级兜底）', async () => {
    writeBuiltin(dmManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'my-danmaku-source.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<{ comments: { url: string } }> };
    m.contributes[0].comments.url = 'https://dm.example.com/all.xml';
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.danmakuSources()).toEqual([]);
  });
});

describe('PluginHost — 插件直播输出模板（contributes.live.template，输出侧格式化）', () => {
  const ltManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-live-tpl',
      name: '我的直播模板',
      contributes: [
        {
          type: 'live.template',
          id: 'my-pipe',
          label: '竖线格式',
          format: 'txt',
          group: '== {group} ==',
          line: '{index} | {name} | {url}',
        },
        // ★ 一个插件可声明**多个**输出模板（各自独立 id）
        {
          type: 'live.template',
          id: 'my-m3u',
          label: '我的 M3U',
          format: 'm3u',
          header: ['#EXTM3U'],
          line: '#EXTINF:-1 group-title="{group}",{name}\n{url}',
        },
      ],
      ...over,
    });

  it('声明 live.template 且已启用 → 暴露为宿主模板（多模板 / pluginId / ext / render 对口径）', async () => {
    writeBuiltin(ltManifest());
    const h = host();
    await h.init();
    const list = await h.liveTemplates();
    expect(list.map((t) => t.id)).toEqual(['my-pipe', 'my-m3u']);
    expect(list.map((t) => t.pluginId)).toEqual(['my-live-tpl', 'my-live-tpl']);
    expect(list[0].label).toBe('竖线格式');
    expect(list[0].format).toBe('txt');
    expect(list[0].ext).toBe('txt');
    expect(list[1].ext).toBe('m3u');
    expect(typeof list[0].render).toBe('function');
    expect((await h.list())[0].level).toBe('L2');
  });

  it('停用 → 不参与模板列表', async () => {
    writeBuiltin(ltManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-live-tpl', false);
    expect(await h.liveTemplates()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无直播模板', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.liveTemplates()).toEqual([]);
  });

  it('磁盘清单被篡改（line 缺 {url}）→ 跳过装配（内容级兜底）', async () => {
    writeBuiltin(ltManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'my-live-tpl.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<{ line: string }> };
    m.contributes[0].line = '{name}'; // 丢掉 {url}
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.liveTemplates()).toEqual([]);
  });
});

describe('PluginHost — 插件受限动作按钮（contributes.ui.command）', () => {
  const cmdManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-cmd-pack',
      name: '我的命令插件',
      contributes: [
        { type: 'ui.command', id: 'open-site', label: '打开官网', placement: ['config'], action: 'open-url', url: 'https://example.com/' },
        // ★ 一个插件可声明**多个**命令（各自独立 id）
        { type: 'ui.command', id: 'go-live', label: '去直播', placement: ['player'], action: 'navigate', to: 'live' },
      ],
      ...over,
    });

  it('声明 ui.command 且已启用 → 摊平为视图（多命令 / pluginName / 字段搬运）', async () => {
    writeBuiltin(cmdManifest());
    const h = host();
    await h.init();
    const list = await h.uiCommands();
    expect(list.map((c) => c.id)).toEqual(['open-site', 'go-live']);
    expect(list.map((c) => c.pluginId)).toEqual(['my-cmd-pack', 'my-cmd-pack']);
    expect(list[0].pluginName).toBe('我的命令插件');
    expect(list[0].action).toBe('open-url');
    expect(list[0].url).toBe('https://example.com/');
    expect(list[0].placement).toEqual(['config']);
    expect(list[1].to).toBe('live');
    expect(list[1].placement).toEqual(['player']);
    expect((await h.list())[0].level).toBe('L3');
  });

  it('停用 → 不参与命令列表', async () => {
    writeBuiltin(cmdManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-cmd-pack', false);
    expect(await h.uiCommands()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无命令', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.uiCommands()).toEqual([]);
  });

  it('磁盘清单被篡改（navigate 缺 to）→ 不装配命令', async () => {
    writeBuiltin(cmdManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'my-cmd-pack.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<Record<string, unknown>> };
    delete m.contributes[1].to; // navigate 必须有 to
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    // ★ 篡改后的清单过不了 `validatePluginManifest` ⇒ `PluginRegistry` 读该目录清单为 null
    //   （不再作为已物化条目登记，落回「随包 zip 未就位」态）⇒ 装配层拿不到可用的贡献项。
    expect(await h2.uiCommands()).toEqual([]);
    expect((await h2.list())[0]?.ready).toBe(false);
  });
});

describe('PluginHost — 插件快捷键（contributes.keymap）', () => {
  const keyManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-key-pack',
      name: '我的快捷键插件',
      contributes: [
        { type: 'keymap', id: 'go-discover', label: '去发现页', scope: ['app'], key: 'Ctrl+Alt+F', action: 'navigate', to: 'discover' },
        // ★ 一个插件可声明**多条**快捷键（各自独立 id）；键位串会被归一化
        { type: 'keymap', id: 'open-help', label: '打开帮助', scope: ['app', 'player'], key: 'alt+ctrl+1', action: 'open-url', url: 'https://example.com/help' },
      ],
      ...over,
    });

  it('声明 keymap 且已启用 → 摊平为视图（多条 / pluginName / 键位归一 / scope）', async () => {
    writeBuiltin(keyManifest());
    const h = host();
    await h.init();
    const list = await h.keymaps();
    expect(list.map((k) => k.id)).toEqual(['go-discover', 'open-help']);
    expect(list.map((k) => k.pluginId)).toEqual(['my-key-pack', 'my-key-pack']);
    expect(list[0].pluginName).toBe('我的快捷键插件');
    expect(list[0].key).toBe('Ctrl+Alt+F');
    expect(list[0].action).toBe('navigate');
    expect(list[0].to).toBe('discover');
    expect(list[0].scope).toEqual(['app']);
    // ★ 键位串归一：`alt+ctrl+1` → `Ctrl+Alt+1`
    expect(list[1].key).toBe('Ctrl+Alt+1');
    expect(list[1].scope).toEqual(['app', 'player']);
    expect(list[1].url).toBe('https://example.com/help');
    expect((await h.list())[0].level).toBe('L3');
  });

  it('停用 → 不参与快捷键列表', async () => {
    writeBuiltin(keyManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-key-pack', false);
    expect(await h.keymaps()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无快捷键', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.keymaps()).toEqual([]);
  });

  it('磁盘清单被篡改（键位缺修饰键）→ 不装配快捷键', async () => {
    writeBuiltin(keyManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'my-key-pack.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<Record<string, unknown>> };
    m.contributes[0].key = 'F1'; // 缺 Ctrl/Alt/Meta ⇒ 过不了校验
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    // ★ 篡改后的清单过不了 `validatePluginManifest` ⇒ `PluginRegistry` 读该目录清单为 null
    //   （不再作为已物化条目登记，落回「随包 zip 未就位」态）⇒ 装配层拿不到可用的贡献项。
    expect(await h2.keymaps()).toEqual([]);
    expect((await h2.list())[0]?.ready).toBe(false);
  });
});

describe('PluginHost — 插件设置面板（contributes.settings.panel）', () => {
  const panelManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-settings-pack',
      name: '我的设置插件',
      contributes: [
        // ★ 一个插件可声明**多个**面板（各自独立 id）
        {
          type: 'settings.panel',
          id: 'general',
          label: '常规设置',
          fields: [
            { key: 'on', label: '启用', type: 'toggle', default: true },
            { key: 'mode', label: '模式', type: 'select', default: 'a', options: [{ value: 'a' }, { value: 'b' }] },
          ],
        },
        {
          type: 'settings.panel',
          id: 'adv',
          label: '高级设置',
          fields: [{ key: 'n', label: '数量', type: 'number', default: 5, min: 1, max: 10 }],
        },
      ],
      ...over,
    });

  it('声明 settings.panel 且已启用 → 摊平为视图（多面板 / 字段默认值 / pluginName）', async () => {
    writeBuiltin(panelManifest());
    const h = host();
    await h.init();
    const list = await h.settingsPanels();
    expect(list.map((p) => p.id)).toEqual(['general', 'adv']);
    expect(list.map((p) => p.pluginId)).toEqual(['my-settings-pack', 'my-settings-pack']);
    expect(list[0].pluginName).toBe('我的设置插件');
    expect(list[0].fields.map((f) => f.value)).toEqual([true, 'a']);
    expect(list[0].fields[0].type).toBe('toggle');
    expect(list[1].fields[0].value).toBe(5);
    expect((await h.list())[0].level).toBe('L3');
  });

  it('写值生效并**落盘**（新开一个 host 仍读得到 → 值确实持久化在 plugin-settings.json）', async () => {
    writeBuiltin(panelManifest());
    const h = host();
    await h.init();
    const r = await h.setPluginSetting({ id: 'my-settings-pack', panelId: 'general', key: 'mode', value: 'b' });
    expect(r.ok).toBe(true);
    expect(r.panels?.[0].fields.map((f) => f.value)).toEqual([true, 'b']);
    // ★ 落盘取证：设置文件里按 pluginId → panelId → fieldKey 分桶
    const file = join(root, 'plugin-settings.json');
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>;
    expect(JSON.parse(saved['my-settings-pack'])).toEqual({ general: { mode: 'b' } });
    // 新实例（模拟重启）仍读得到存值
    const h2 = host();
    await h2.init();
    expect((await h2.settingsPanels())[0].fields.map((f) => f.value)).toEqual([true, 'b']);
  });

  it('非法值 → **明确拒绝**（不静默强转 / 不写盘），面板值不变', async () => {
    writeBuiltin(panelManifest());
    const h = host();
    await h.init();
    const bad = [
      { panelId: 'general', key: 'on', value: 'yes' },        // toggle 非布尔
      { panelId: 'general', key: 'mode', value: 'c' },        // 不在 options
      { panelId: 'adv', key: 'n', value: 99 },                // 超出 max
      { panelId: 'general', key: 'nope', value: 1 },          // 未知字段
      { panelId: 'nope', key: 'on', value: true },            // 未知面板
    ];
    for (const a of bad) {
      const r = await h.setPluginSetting({ id: 'my-settings-pack', ...a });
      expect(r.ok, `${a.panelId}/${a.key}=${a.value}`).toBe(false);
    }
    expect((await h.settingsPanels())[0].fields.map((f) => f.value)).toEqual([true, 'a']);
    expect(existsSync(join(root, 'plugin-settings.json'))).toBe(false);
  });

  it('停用 → 不装配；磁盘清单被篡改（toggle 的 default 写成字符串）→ 不装配', async () => {
    writeBuiltin(panelManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-settings-pack', false);
    expect(await h.settingsPanels()).toEqual([]);
    await h.setEnabled('my-settings-pack', true);
    expect((await h.settingsPanels()).length).toBe(2); // 恢复启用后确实装配（下面的「空」才是篡改导致的）

    // 篡改：过不了 `validatePluginManifest` ⇒ 不再作为已物化条目登记（ready:false）⇒ 装配层拿不到
    const pj = join(pluginsDir, 'my-settings-pack.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<Record<string, unknown>> };
    (m.contributes[0].fields as Array<Record<string, unknown>>)[0].default = 'yes';
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.settingsPanels()).toEqual([]);
    expect((await h2.list())[0]?.ready).toBe(false);
  });
});

describe('PluginHost — 插件受限 UI 槽位（contributes.ui.slot）', () => {
  const slotManifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
    manifest({
      id: 'my-slot-pack',
      name: '我的槽位插件',
      contributes: [
        {
          type: 'ui.slot',
          id: 'discover-tip',
          slot: ['discover', 'home'],
          label: '插件推荐位',
          items: [
            { type: 'heading', text: '本周精选' },
            { type: 'image', url: 'https://example.com/a.png', alt: '示例图' },
            { type: 'link', label: '打开帮助', action: 'open-url', url: 'https://example.com/help' },
          ],
        },
        // ★ 一个插件可声明**多个**槽位（各自独立 id）
        { type: 'ui.slot', id: 'live-tip', slot: ['live'], items: [{ type: 'text', text: '直播页插件提示' }] },
      ],
      ...over,
    });

  it('声明 ui.slot 且已启用 → 摊平为视图（多槽位 / 组件树 / pluginName）', async () => {
    writeBuiltin(slotManifest());
    const h = host();
    await h.init();
    const list = await h.uiSlots();
    expect(list.map((s) => s.id)).toEqual(['discover-tip', 'live-tip']);
    expect(list.map((s) => s.pluginId)).toEqual(['my-slot-pack', 'my-slot-pack']);
    expect(list[0].pluginName).toBe('我的槽位插件');
    expect(list[0].slot).toEqual(['discover', 'home']);
    expect(list[0].label).toBe('插件推荐位');
    expect(list[0].items.map((i) => i.type)).toEqual(['heading', 'image', 'link']);
    expect(list[0].items[2].action).toBe('open-url');
    expect(list[1].slot).toEqual(['live']);
    expect((await h.list())[0].level).toBe('L3');
  });

  it('停用 → 不参与槽位列表', async () => {
    writeBuiltin(slotManifest());
    const h = host();
    await h.init();
    await h.setEnabled('my-slot-pack', false);
    expect(await h.uiSlots()).toEqual([]);
  });

  it('只声明 mpv.shaders 的插件 → 无槽位', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(await h.uiSlots()).toEqual([]);
  });

  it('磁盘清单被篡改（image 的 url 非 http）→ 不装配槽位', async () => {
    writeBuiltin(slotManifest());
    const h1 = host();
    await h1.init();
    const pj = join(pluginsDir, 'my-slot-pack.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<Record<string, unknown>> };
    (m.contributes[0].items as Array<Record<string, unknown>>)[1].url = 'ftp://example.com/a.png';
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    // ★ 篡改后清单过不了 `validatePluginManifest` ⇒ 该目录不再登记为已物化条目（ready:false）⇒ 装配层拿不到
    expect(await h2.uiSlots()).toEqual([]);
    expect((await h2.list())[0]?.ready).toBe(false);
  });
});

describe('PluginHost — 目录整洁', () => {
  it('物化/安装后 pluginsDir 无 .tmp/.bak 残留', async () => {
    writeBuiltin(manifest());
    const h = host();
    await h.init();
    expect(readdirSync(pluginsDir).some((n) => n.endsWith('.tmp') || n.endsWith('.bak'))).toBe(false);
  });
});

// ★ 2026-10-18（R10）L4 沙箱：生命周期接线（注入**假 factory**，不起真 worker）
class FakeSandbox implements SandboxLike {
  running = false;
  error: string | undefined;
  disposed = false;
  readonly opts: PluginSandboxOptions;
  constructor(opts: PluginSandboxOptions) {
    this.opts = opts;
  }
  async start(): Promise<{ ok: boolean; error?: string }> {
    this.running = true;
    return { ok: true };
  }
  dispose(): void {
    this.disposed = true;
    this.running = false;
  }
}

const noopLogger = { i: (): void => undefined, w: (): void => undefined, e: (): void => undefined };

function fakeApi(): PluginSandboxApi {
  return {
    http: async () => ({ status: 200, headers: {}, content: '' }),
    download: async () => ({ bytes: 0 }),
    kv: () => '',
    settings: () => undefined,
    fs: () => undefined,
    log: () => undefined,
    notify: async () => undefined,
    clipboard: () => '',
    dialog: async () => undefined,
    player: async () => ({ ok: true }),
    openExternal: async () => undefined,
  };
}

describe('PluginHost — L4 沙箱（kind:"code"）', () => {
  let made: FakeSandbox[] = [];

  function l4Host(): PluginHost {
    made = [];
    const h = new PluginHost({ pluginsDir, builtinDir, statePath });
    h.attachSandbox({
      api: fakeApi(),
      workerFile: 'unused.cjs',
      logger: noopLogger,
      factory: (o) => {
        const s = new FakeSandbox(o);
        made.push(s);
        return s;
      },
    });
    return h;
  }

  function writeCode(id: string, over: Partial<PluginManifest> = {}): void {
    const dir = join(pluginsDir, `${id}.winbox`);
    mkdirSync(dir, { recursive: true });
    const m = {
      manifestVersion: 1,
      id,
      name: 'L4 插件',
      version: '1.0.0',
      apiVersion: HOST_API_VERSION,
      kind: 'code' as const,
      main: 'main.js',
      permissions: ['log'],
      contributes: [],
      ...over,
    };
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(m));
    writeFileSync(join(dir, 'main.js'), 'winbox.log.i("x")');
  }

  it('启用 + code + 就位 → 沙箱启动；list() 带 kind/permissions/sandbox', async () => {
    writeCode('l4-demo');
    const h = l4Host();
    await h.init();
    const [v] = await h.list();
    expect(v.kind).toBe('code');
    expect(v.permissions).toEqual(['log']);
    expect(v.sandbox?.running).toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0].opts.pluginDir).toBe(join(pluginsDir, 'l4-demo.winbox'));
    expect(made[0].opts.mainFile).toBe('main.js');
  });

  it('停用 → 沙箱释放；重新启用 → 再启动', async () => {
    writeCode('l4-demo');
    const h = l4Host();
    await h.init();
    await h.setEnabled('l4-demo', false);
    expect((await h.list())[0].sandbox?.running).toBe(false);
    expect(made[0].disposed).toBe(true);
    await h.setEnabled('l4-demo', true);
    expect((await h.list())[0].sandbox?.running).toBe(true);
  });

  it('asset 插件 → sandbox 恒 undefined（不起沙箱）', async () => {
    writeBuiltin(manifest()); // mpv.shaders（kind=asset）
    const h = l4Host();
    await h.init();
    expect((await h.list())[0].sandbox).toBeUndefined();
    expect(made).toHaveLength(0);
  });

  it('pluginSettingsAccess：get 回落 default / set 非法值抛 / set 合法值反映到 settingsPanels', async () => {
    writeCode('l4-demo', {
      permissions: ['log', 'settings'],
      contributes: [
        { type: 'settings.panel', id: 'cfg', label: '配置', fields: [{ key: 'flag', label: '开关', type: 'toggle', default: true }] },
      ],
    });
    const h = l4Host();
    await h.init();
    const acc = h.pluginSettingsAccess();
    expect(acc.get('l4-demo', 'flag')).toBe(true); // 未存 → 回落 default
    expect(acc.get('l4-demo', 'nope')).toBeUndefined();
    expect(() => acc.set('l4-demo', 'flag', 'not-bool')).toThrow();
    acc.set('l4-demo', 'flag', false);
    expect(acc.get('l4-demo', 'flag')).toBe(false);
    const panels = await h.settingsPanels();
    expect(panels[0].fields[0].value).toBe(false);
  });
});

// ★ 2026-10-18（R11）第三方播放内核（`contributes.player.engine`）：宿主只做「exe 就绪判定 + 摊平」
describe('PluginHost — 插件播放内核（contributes.player.engine）', () => {
  /** 直接把插件目录写到磁盘（不走安装校验，模拟「已装」/「磁盘篡改」两种情形） */
  function writeEngine(id: string, over: Record<string, unknown> = {}, files: Record<string, string> = { 'files/mpv.exe': 'MZ' }): void {
    const dir = join(pluginsDir, `${id}.winbox`);
    mkdirSync(dir, { recursive: true });
    const m = {
      manifestVersion: 1,
      id,
      name: '我的内核',
      version: '1.0.0',
      apiVersion: HOST_API_VERSION,
      kind: 'code' as const,
      main: 'main.js',
      permissions: ['log'],
      contributes: [
        {
          type: 'player.engine',
          id: 'my-mpv',
          label: '我的 MPV',
          protocol: 'mpv-ipc',
          binary: { source: 'plugin-file', file: 'files/mpv.exe' },
          args: ['--no-config', '--wid={wid}', '--input-ipc-server={pipe}', '{url}'],
          capabilities: ['seek', 'fit'],
        },
      ],
      ...over,
    };
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(m));
    writeFileSync(join(dir, 'main.js'), '/* descriptor-only plugin */');
    const names = Object.entries(files);
    if (names.length) mkdirSync(join(dir, 'files'), { recursive: true });
    for (const [name, body] of names) writeFileSync(join(dir, name), body);
  }

  it('就绪：`plugin-file` 落在插件目录内 → ready + 绝对路径 + capabilities；未就绪仍出现且带人话 note', async () => {
    writeEngine('engine-ok');
    writeEngine('engine-missing', {
      contributes: [{
        type: 'player.engine', id: 'ghost-mpv', label: '缺文件的内核', protocol: 'json-lines',
        binary: { source: 'plugin-file', file: 'files/missing.exe' },
        args: ['--wid={wid}', '{url}'],
      }],
    }, {});
    const h = host();
    await h.init();
    const list = await h.playerEngines();
    expect(list.map((v) => v.id).sort()).toEqual(['engine:ghost-mpv', 'engine:my-mpv']);

    const ok = list.find((v) => v.id === 'engine:my-mpv')!;
    expect(ok).toMatchObject({
      pluginId: 'engine-ok', pluginName: '我的内核', label: '我的 MPV', source: 'plugin-file', ready: true,
      path: join(pluginsDir, 'engine-ok.winbox', 'files', 'mpv.exe'),
    });
    expect(ok.capabilities).toEqual(['seek', 'fit']);

    const missing = list.find((v) => v.id === 'engine:ghost-mpv')!;
    expect(missing.ready).toBe(false);
    expect(missing.note).toBeTruthy();
    expect(missing.path).toBe(join(pluginsDir, 'engine-missing.winbox', 'files', 'missing.exe'));
  });

  it('停用插件 → 其内核不出现在列表里', async () => {
    writeEngine('engine-ok');
    const h = host();
    await h.init();
    expect((await h.playerEngines()).map((v) => v.id)).toEqual(['engine:my-mpv']);
    await h.setEnabled('engine-ok', false);
    expect(await h.playerEngines()).toEqual([]);
    // 未就绪时 `playerEngineSpec` 也拿不到启动规格
    expect(await h.playerEngineSpec('engine:my-mpv')).toBeNull();
  });

  it('asset 插件（磁盘上硬写 player.engine）→ 不出现（`player.engine` 恒 kind="code"）', async () => {
    writeEngine('engine-asset', { kind: 'asset', main: undefined, permissions: [] });
    const h = host();
    await h.init();
    expect(await h.playerEngines()).toEqual([]);
  });

  it('磁盘篡改兜底：manifest 内容被改坏（json-lines 带 {pipe}）→ 不再装配（内容级兜底）', async () => {
    writeEngine('engine-ok');
    const h1 = host();
    await h1.init();
    expect(await h1.playerEngines()).toHaveLength(1);
    // 手改 plugin.json：把协议必需/禁止占位符改坏
    const pj = join(pluginsDir, 'engine-ok.winbox', 'plugin.json');
    const m = JSON.parse(readFileSync(pj, 'utf-8')) as { contributes: Array<Record<string, unknown>> };
    m.contributes[0].protocol = 'json-lines';
    m.contributes[0].args = ['--wid={wid}', '{url}', '--pipe={pipe}'];
    writeFileSync(pj, JSON.stringify(m));
    const h2 = host();
    await h2.init();
    expect(await h2.playerEngines()).toEqual([]);
  });
});
