// tests/pluginContract.spec.ts — 插件清单契约校验（纯函数）：
//   ① validatePluginManifest 的逐条约束（id / apiVersion / kind↔permissions / main /
//      contributes 白名单与 kind 匹配 / 运行库许可清单 / 路径安全 / updateCheckUrl）；
//   ② 分级与档位取值；
//   ③ 交叉校验：仓库内的超分示例清单必须通过宿主契约校验。
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractArchiveEntries } from '../src/main/subtitle/archive';
import {
  expandSubTemplate,
  jsonPathGet,
  liveTemplateContributeOf,
  parseKeyCombo,
  playerEngineContributeOf,
  settingsEffectiveValue,
  settingsPanelContributeOf,
  settingsValueError,
  uiSlotContributeOf,
  validateDanmakuSourceContribute,
  validateDiscoverSourceContribute,
  validateKeymapContribute,
  validateLiveTemplateContribute,
  validateMetaProviderContribute,
  validatePlayerEngineContribute,
  validatePluginManifest,
  validateSettingsPanelContribute,
  validateSubtitleProviderContribute,
  validateThemeContribute,
  validateUiCommandContribute,
  validateUiSlotContribute,
  uiCommandContributeOf,
  keymapContributeOf,
  themeContributeOf,
  isSafeRelPath,
  pluginLevelOf,
  shadersForMode,
  shaderModes,
  HOST_API_VERSION,
  DEP_ALLOWLIST,
  PERMISSIONS,
  PERMISSION_LABELS,
  FORBIDDEN_PERMISSIONS,
  PLAYER_ENGINE_CAPABILITIES,
  PLAYER_ENGINE_PROTOCOLS,
  isPermission,
  THEME_TOKENS,
  KEYMAP_SCOPES,
  SETTINGS_FIELD_TYPES,
  UI_SLOT_IDS,
  UI_SLOT_ITEM_TYPES,
  type PluginManifest,
} from '../src/shared/plugin';

function base(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: 'demo-plugin',
    name: '演示插件',
    version: '1.0.0',
    apiVersion: HOST_API_VERSION,
    kind: 'asset',
    permissions: [],
    contributes: [{ type: 'mpv.shaders', modes: [{ id: 'efficiency', label: '效率档', shaders: ['a.glsl'] }] }],
    ...over,
  };
}

describe('plugin 契约 — validatePluginManifest', () => {
  it('合法 asset 清单通过', () => {
    expect(validatePluginManifest(base())).toEqual({ ok: true });
  });

  it('缺清单 / manifestVersion 错 → MISSING_MANIFEST', () => {
    expect(validatePluginManifest(null).reasonCode).toBe('MISSING_MANIFEST');
    expect(validatePluginManifest(base({ manifestVersion: 2 })).reasonCode).toBe('MISSING_MANIFEST');
  });

  it('id 非法 → ID_INVALID', () => {
    for (const bad of ['AB', 'a', '-abc', 'abc-', '中文id', 'a b']) {
      expect(validatePluginManifest(base({ id: bad })).reasonCode).toBe('ID_INVALID');
    }
  });

  it('apiVersion 主版本不匹配 → API_VERSION_MISMATCH', () => {
    expect(validatePluginManifest(base({ apiVersion: '2.x' })).reasonCode).toBe('API_VERSION_MISMATCH');
    expect(validatePluginManifest(base({ apiVersion: '1.9' })).ok).toBe(true);
  });

  it('asset 带 permissions / 带 main → KIND_PERM_MISMATCH', () => {
    expect(validatePluginManifest(base({ permissions: ['net'] })).reasonCode).toBe('KIND_PERM_MISMATCH');
    expect(validatePluginManifest(base({ main: 'main.js' })).reasonCode).toBe('KIND_PERM_MISMATCH');
  });

  it('code 缺 permissions / 缺 main → KIND_PERM_MISMATCH / PATH_ESCAPE', () => {
    const codeNoPerm = base({ kind: 'code', main: 'main.js', permissions: [] });
    expect(validatePluginManifest(codeNoPerm).reasonCode).toBe('KIND_PERM_MISMATCH');
    const codeNoMain = base({ kind: 'code', permissions: ['net'] });
    expect(validatePluginManifest(codeNoMain).reasonCode).toBe('PATH_ESCAPE');
  });

  it('禁用 / 未收录权限 → UNKNOWN_PERMISSION', () => {
    const bad = base({ kind: 'code', main: 'main.js', permissions: ['cred'] });
    expect(validatePluginManifest(bad).reasonCode).toBe('UNKNOWN_PERMISSION');
  });

  it('未知 contributes / kind 不匹配 → UNKNOWN_CONTRIBUTE / UNKNOWN_CONTRIBUTE_KIND', () => {
    expect(validatePluginManifest(base({ contributes: [{ type: 'code.spider' }] })).reasonCode).toBe('UNKNOWN_CONTRIBUTE');
    expect(validatePluginManifest(base({ contributes: [{ type: 'player.engine' }] })).reasonCode).toBe('UNKNOWN_CONTRIBUTE_KIND');
  });

  it('shader 名称路径逃逸 → PATH_ESCAPE', () => {
    const bad = base({ contributes: [{ type: 'mpv.shaders', modes: [{ id: 'x', label: 'X', shaders: ['../a.glsl'] }] }] });
    expect(validatePluginManifest(bad).reasonCode).toBe('PATH_ESCAPE');
  });

  it('运行库不在许可清单 → DEP_NOT_ALLOWED', () => {
    expect(validatePluginManifest(base({ runtimeDeps: [{ id: 'not-allowlisted' }] })).reasonCode).toBe('DEP_NOT_ALLOWED');
    expect(validatePluginManifest(base({ runtimeDeps: [{ id: 'anime4k-shaders' }] })).ok).toBe(true);
  });

  it('updateCheckUrl 非 https → BAD_UPDATE_URL', () => {
    expect(validatePluginManifest(base({ updateCheckUrl: 'http://x/latest.json' })).reasonCode).toBe('BAD_UPDATE_URL');
  });

  it('isSafeRelPath：拒绝绝对路径 / .. / 盘符', () => {
    expect(isSafeRelPath('a/b.glsl')).toBe(true);
    expect(isSafeRelPath('a\\b.glsl')).toBe(true);
    expect(isSafeRelPath('../a.glsl')).toBe(false);
    expect(isSafeRelPath('/etc/passwd')).toBe(false);
    expect(isSafeRelPath('C:/x')).toBe(false);
    expect(isSafeRelPath('a/../../b')).toBe(false);
    expect(isSafeRelPath('')).toBe(false);
  });
});

describe('plugin 契约 — 分级与档位', () => {
  it('asset 按 contributes 取级别；code 恒为 L4', () => {
    expect(pluginLevelOf(base())).toBe('L1');
    expect(pluginLevelOf(base({ contributes: [{ type: 'ui.slot' }] }))).toBe('L3');
    expect(pluginLevelOf(base({ kind: 'code', main: 'm.js', permissions: ['net'] }))).toBe('L4');
  });

  it('档位取值保持顺序', () => {
    const c = [{ type: 'mpv.shaders', modes: [{ id: 'q', label: '质量档', shaders: ['a.glsl', 'b.glsl'] }] }];
    expect(shadersForMode(c, 'mpv.shaders', 'q')).toEqual(['a.glsl', 'b.glsl']);
    expect(shadersForMode(c, 'mpv.shaders', 'nope')).toEqual([]);
    expect(shaderModes(c, 'mpv.shaders').map((m) => m.label)).toEqual(['质量档']);
  });

  it('许可清单含首批三套着色器 dep', () => {
    for (const id of ['anime4k-shaders', 'ravu-lite-shaders', 'fsrcnnx-shaders']) {
      expect(DEP_ALLOWLIST[id]).toBeTruthy();
    }
  });
});

describe('plugin 契约 — theme（皮肤：纯令牌 + 声明式 layout）', () => {
  const theme = (over: Record<string, unknown> = {}) => ({
    type: 'theme', id: 'sakura', label: '🌸 樱花', base: 'dark',
    tokens: { '--accent': '#e879a6', '--surface-0': '#120d12' },
    ...over,
  });

  it('合法 theme 通过（含 layout）', () => {
    expect(validateThemeContribute(theme({ layout: { nav: 'top', density: 'comfy', radiusScale: 1.5 } })))
      .toEqual({ ok: true });
  });

  it('词表完整且不含任何私有前缀', () => {
    expect(THEME_TOKENS['--surface-glass']?.requiresAlpha).toBe(true);
    expect(THEME_TOKENS['--on-accent']).toBeTruthy();
    expect(THEME_TOKENS['--dur-page']?.max).toBe(800);
    expect(THEME_TOKENS['--fs-2xl']).toBeTruthy();
    for (const k of ['--nf-red', '--b-blue', '--ap-dim', '--db-orange']) expect(THEME_TOKENS[k]).toBeUndefined();
  });

  it('缺 id/label/base/tokens → THEME_TOKENS_REQUIRED', () => {
    expect(validateThemeContribute(theme({ id: 'AB' })).reasonCode).toBe('THEME_TOKENS_REQUIRED');
    expect(validateThemeContribute(theme({ label: '  ' })).reasonCode).toBe('THEME_TOKENS_REQUIRED');
    expect(validateThemeContribute(theme({ base: 'gray' })).reasonCode).toBe('THEME_TOKENS_REQUIRED');
    expect(validateThemeContribute(theme({ tokens: {} })).reasonCode).toBe('THEME_TOKENS_REQUIRED');
    expect(validateThemeContribute(theme({ tokens: [] })).reasonCode).toBe('THEME_TOKENS_REQUIRED');
  });

  it('自造 / 未收录令牌名 → UNKNOWN_THEME_TOKEN', () => {
    expect(validateThemeContribute(theme({ tokens: { '--nf-red': '#e50914' } })).reasonCode).toBe('UNKNOWN_THEME_TOKEN');
    expect(validateThemeContribute(theme({ tokens: { '--nope': '#ffffff' } })).reasonCode).toBe('UNKNOWN_THEME_TOKEN');
  });

  it('值类型 / 范围错 → BAD_THEME_TOKEN_VALUE', () => {
    expect(validateThemeContribute(theme({ tokens: { '--accent': 'red' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    expect(validateThemeContribute(theme({ tokens: { '--accent': '12px' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    expect(validateThemeContribute(theme({ tokens: { '--radius': '40px' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    expect(validateThemeContribute(theme({ tokens: { '--radius': '12' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    expect(validateThemeContribute(theme({ tokens: { '--dur-panel': '2s' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    expect(validateThemeContribute(theme({ tokens: { '--ease-standard': 'ease-in' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    expect(validateThemeContribute(theme({ tokens: { '--shadow': '#000' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    expect(validateThemeContribute(theme({ tokens: { '--dur-panel': '240ms' } })).ok).toBe(true);
    expect(validateThemeContribute(theme({ tokens: { '--shadow': '0 8px 24px rgba(0,0,0,.35)' } })).ok).toBe(true);
  });

  it('需透明通道的令牌给不透明色 → BAD_THEME_TOKEN_VALUE', () => {
    expect(validateThemeContribute(theme({ tokens: { '--surface-glass': '#000000' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    expect(validateThemeContribute(theme({ tokens: { '--surface-glass': 'rgba(0,0,0,.9)' } })).ok).toBe(true);
    expect(validateThemeContribute(theme({ tokens: { '--hairline': '#262c3b80' } })).ok).toBe(true);
  });

  it('var() 只允许引用词表内令牌', () => {
    expect(validateThemeContribute(theme({ tokens: { '--hairline': 'var(--border-soft)' } })).ok).toBe(true);
    expect(validateThemeContribute(theme({ tokens: { '--hairline': 'var(--nf-dim)' } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
  });

  it('CSS 注入片段一律拒', () => {
    for (const bad of ['#fff;color:red', 'url(x)', 'rgb(0,0,0)}', '#fff/*x*/']) {
      expect(validateThemeContribute(theme({ tokens: { '--accent': bad } })).reasonCode).toBe('BAD_THEME_TOKEN_VALUE');
    }
  });

  it('夹带样式表 → THEME_STYLE_NOT_ALLOWED（v1）', () => {
    expect(validateThemeContribute(theme({ css: 'button{}' })).reasonCode).toBe('THEME_STYLE_NOT_ALLOWED');
    expect(validateThemeContribute(theme({ style: 'theme.css' })).reasonCode).toBe('THEME_STYLE_NOT_ALLOWED');
  });

  it('layout 非法 → BAD_THEME_LAYOUT', () => {
    expect(validateThemeContribute(theme({ layout: { nav: 'left' } })).reasonCode).toBe('BAD_THEME_LAYOUT');
    expect(validateThemeContribute(theme({ layout: { nope: 1 } })).reasonCode).toBe('BAD_THEME_LAYOUT');
    expect(validateThemeContribute(theme({ layout: { sideWidth: 999 } })).reasonCode).toBe('BAD_THEME_LAYOUT');
    expect(validateThemeContribute(theme({ layout: { density: 'compact', cardWidth: 160 } })).ok).toBe(true);
  });

  it('结构枚举（shell / detailStyle / discoverStyle / filterStyle）取值受控', () => {
    expect(validateThemeContribute(theme({ layout: { shell: 'sidebar', detailStyle: 'cinema', discoverStyle: 'shelf', filterStyle: 'card' } })).ok).toBe(true);
    expect(validateThemeContribute(theme({ layout: { shell: 'pillbar', discoverStyle: 'wall' } })).ok).toBe(true);
    expect(validateThemeContribute(theme({ layout: { shell: 'floating' } })).reasonCode).toBe('BAD_THEME_LAYOUT');
    expect(validateThemeContribute(theme({ layout: { detailStyle: 'foo' } })).reasonCode).toBe('BAD_THEME_LAYOUT');
    expect(validateThemeContribute(theme({ layout: { discoverStyle: 'poster-wall' } })).reasonCode).toBe('BAD_THEME_LAYOUT');
    expect(validateThemeContribute(theme({ layout: { filterStyle: 'pill' } })).reasonCode).toBe('BAD_THEME_LAYOUT');
  });

  it('整单走通：theme 插件是 L1 asset', () => {
    const m = base({ contributes: [theme({ layout: { nav: 'top' } })] as PluginManifest['contributes'] });
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    expect(pluginLevelOf(m)).toBe('L1');
  });

  it('整单拒装：theme 内容非法时与直接校验同码', () => {
    const bad = base({ contributes: [{ type: 'theme', id: 'sakura', label: 'x', base: 'dark', tokens: { '--nf-red': '#e50914' } }] });
    expect(validatePluginManifest(bad).reasonCode).toBe('UNKNOWN_THEME_TOKEN');
  });

  it('code 插件不得声明 theme（kind 不匹配）', () => {
    const bad = base({ kind: 'code', main: 'main.js', permissions: ['net'], contributes: [theme()] as PluginManifest['contributes'] });
    expect(validatePluginManifest(bad).reasonCode).toBe('UNKNOWN_CONTRIBUTE_KIND');
  });
});

describe('plugin 契约 — subtitle.provider（L2 声明式字幕源：URL 模板 + JSON 路径）', () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    type: 'subtitle.provider',
    id: 'my-subs',
    name: '我的字幕站',
    search: {
      url: 'https://sub.example.com/api/search?q={keyword}&ep={ep}',
      headers: { Referer: 'https://sub.example.com/' },
      list: 'data.list',
      map: { file: 'id', subname: 'filename', title: 'video_title', lang: 'language' },
    },
    fetch: { url: 'https://sub.example.com/api/download/{file}' },
    ...over,
  });
  const search = (over: Record<string, unknown> = {}) => ({
    url: 'https://sub.example.com/api/search?q={keyword}',
    list: 'data.list',
    map: { file: 'id', subname: 'filename' },
    ...over,
  });

  it('合法声明通过', () => {
    expect(validateSubtitleProviderContribute(sub())).toEqual({ ok: true });
  });

  it('缺 id/name/search/map → SUBTITLE_PROVIDER_INVALID', () => {
    expect(validateSubtitleProviderContribute(sub({ id: 'AB' })).reasonCode).toBe('SUBTITLE_PROVIDER_INVALID');
    expect(validateSubtitleProviderContribute(sub({ name: '  ' })).reasonCode).toBe('SUBTITLE_PROVIDER_INVALID');
    expect(validateSubtitleProviderContribute(sub({ search: null })).reasonCode).toBe('SUBTITLE_PROVIDER_INVALID');
    expect(validateSubtitleProviderContribute(sub({ search: search({ map: undefined }) })).reasonCode).toBe('SUBTITLE_PROVIDER_INVALID');
    expect(validateSubtitleProviderContribute(sub({ search: search({ map: { file: 'id' } }) })).reasonCode).toBe('BAD_PROVIDER_PATH');
    expect(validateSubtitleProviderContribute(sub({ search: search({ map: { file: 'id', subname: 'x', nope: 'y' } }) })).reasonCode).toBe('SUBTITLE_PROVIDER_INVALID');
  });

  it('占用内置字幕源 id → SUBTITLE_ID_TAKEN', () => {
    expect(validateSubtitleProviderContribute(sub({ id: 'assrt' })).reasonCode).toBe('SUBTITLE_ID_TAKEN');
    expect(validateSubtitleProviderContribute(sub({ id: 'subtitlecat' })).reasonCode).toBe('SUBTITLE_ID_TAKEN');
  });

  it('url 协议 / 未知占位符 / fetch 缺 {file} → BAD_PROVIDER_URL', () => {
    expect(validateSubtitleProviderContribute(sub({ search: search({ url: 'file:///etc/passwd' }) })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateSubtitleProviderContribute(sub({ search: search({ url: 'https://x/?q={nope}' }) })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateSubtitleProviderContribute(sub({ fetch: { url: 'https://x/all' } })).reasonCode).toBe('BAD_PROVIDER_URL');
    // search 处不许用 fetch 专用占位符
    expect(validateSubtitleProviderContribute(sub({ search: search({ url: 'https://x/?q={file}' }) })).reasonCode).toBe('BAD_PROVIDER_URL');
  });

  it('请求头：走私头 / CRLF 注入 → BAD_PROVIDER_URL', () => {
    expect(validateSubtitleProviderContribute(sub({ search: search({ headers: { Host: 'evil' } }) })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateSubtitleProviderContribute(sub({ search: search({ headers: { 'X-A': 'a\r\nHost: evil' } }) })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateSubtitleProviderContribute(sub({ search: search({ headers: { 'X A': 'b' } }) })).reasonCode).toBe('BAD_PROVIDER_URL');
  });

  it('JSON 路径语法错误 → BAD_PROVIDER_PATH', () => {
    for (const bad of ['', 'a..b', 'a b', 'a/b', '1abc', 'a[-1]']) {
      expect(validateSubtitleProviderContribute(sub({ search: search({ list: bad }) })).reasonCode).toBe('BAD_PROVIDER_PATH');
    }
    expect(validateSubtitleProviderContribute(sub({ search: search({ list: 'data.items[0].list' }) })).ok).toBe(true);
  });

  it('整单走通：L2 asset，permissions 必须为空；code 形暂不校验声明式内容', () => {
    const m = base({ contributes: [sub()] as PluginManifest['contributes'] });
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    expect(pluginLevelOf(m)).toBe('L2');
    const bad = base({ contributes: [sub({ id: 'assrt' })] as PluginManifest['contributes'] });
    expect(validatePluginManifest(bad).reasonCode).toBe('SUBTITLE_ID_TAKEN');
  });

  it('模板展开：url 值百分号编码，头值原样', () => {
    expect(expandSubTemplate('https://x/?q={keyword}&ep={ep}', { keyword: '繁花 S01', ep: '12' }))
      .toBe('https://x/?q=%E7%B9%81%E8%8A%B1%20S01&ep=12');
    expect(expandSubTemplate('https://x/{file}', { file: 'a/b c' })).toBe('https://x/a%2Fb%20c');
    expect(expandSubTemplate('https://x/?q={unknown}', {})).toBe('https://x/?q={unknown}');
  });

  it('JSON 路径取值：点号 + 下标；缺失段 → undefined', () => {
    const data = { data: { list: [{ id: 7, name: 'a' }, { id: 8 }] } };
    expect(jsonPathGet(data, 'data.list')).toEqual([{ id: 7, name: 'a' }, { id: 8 }]);
    expect(jsonPathGet(data, 'data.list[1].id')).toBe(8);
    expect(jsonPathGet(data, 'data.list[9]')).toBeUndefined();
    expect(jsonPathGet(data, 'data.nope.deep')).toBeUndefined();
  });
});

describe('plugin 契约 — meta.provider（L2 声明式元数据源）', () => {
  const meta = (over: Record<string, unknown> = {}) => ({
    type: 'meta.provider',
    id: 'my-meta',
    name: '我的元数据站',
    imageBase: 'https://img.example.com/t/p/w342',
    search: {
      url: 'https://api.example.com/search?q={keyword}&year={year}',
      headers: { Referer: 'https://api.example.com/' },
      list: 'data.results',
      map: { title: 'name', year: 'year', poster: 'poster_path', overview: 'overview', mediaType: 'type' },
    },
    ...over,
  });
  const search = (over: Record<string, unknown> = {}) => ({
    url: 'https://api.example.com/search?q={keyword}',
    list: 'data.results',
    map: { title: 'name' },
    ...over,
  });

  it('合法声明通过', () => {
    expect(validateMetaProviderContribute(meta())).toEqual({ ok: true });
  });

  it('缺 id/name/search/map/title → META_PROVIDER_INVALID', () => {
    expect(validateMetaProviderContribute(meta({ id: 'AB' })).reasonCode).toBe('META_PROVIDER_INVALID');
    expect(validateMetaProviderContribute(meta({ name: '  ' })).reasonCode).toBe('META_PROVIDER_INVALID');
    expect(validateMetaProviderContribute(meta({ search: null })).reasonCode).toBe('META_PROVIDER_INVALID');
    expect(validateMetaProviderContribute(meta({ search: search({ map: undefined }) })).reasonCode).toBe('META_PROVIDER_INVALID');
    expect(validateMetaProviderContribute(meta({ search: search({ map: { year: 'y' } }) })).reasonCode).toBe('BAD_PROVIDER_PATH');
  });

  it('未知字段一律拒（rating 等：宿主 UI 不展示 → 不提供假能力）', () => {
    expect(validateMetaProviderContribute(meta({ search: search({ map: { title: 'n', rating: 'score' } }) })).reasonCode).toBe('META_PROVIDER_INVALID');
    expect(validateMetaProviderContribute(meta({ nope: 1 })).reasonCode).toBe('META_PROVIDER_INVALID');
  });

  it('占用内置来源 id → META_ID_TAKEN', () => {
    expect(validateMetaProviderContribute(meta({ id: 'tmdb' })).reasonCode).toBe('META_ID_TAKEN');
    expect(validateMetaProviderContribute(meta({ id: 'douban' })).reasonCode).toBe('META_ID_TAKEN');
  });

  it('url / imageBase / 占位符 → BAD_PROVIDER_URL；路径语法 → BAD_PROVIDER_PATH', () => {
    expect(validateMetaProviderContribute(meta({ search: search({ url: 'ftp://x/y' }) })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateMetaProviderContribute(meta({ search: search({ url: 'https://x/?q={poster}' }) })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateMetaProviderContribute(meta({ imageBase: 'img.example.com' })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateMetaProviderContribute(meta({ search: search({ list: 'a..b' }) })).reasonCode).toBe('BAD_PROVIDER_PATH');
    expect(validateMetaProviderContribute(meta({ search: search({ list: 'data.items[0].list' }) })).ok).toBe(true);
  });

  it('整单走通：L2 asset；磁盘清单不许有 main/permissions', () => {
    const m = base({ contributes: [meta()] as PluginManifest['contributes'] });
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    expect(pluginLevelOf(m)).toBe('L2');
    expect(validatePluginManifest(base({ contributes: [meta({ id: 'tmdb' })] as PluginManifest['contributes'] })).reasonCode).toBe('META_ID_TAKEN');
  });
});

describe('plugin 契约 — discover.source（L2 声明式发现页数据源）', () => {
  const sec = (over: Record<string, unknown> = {}) => ({
    id: 'my-top-movie',
    title: '我的电影热榜',
    mediaType: 'movie',
    url: 'https://api.example.com/top?type={mediaType}',
    headers: { Referer: 'https://api.example.com/' },
    list: 'data.items',
    imageBase: 'https://img.example.com/t/p/w342',
    map: { title: 'name', year: 'year', poster: 'poster_path' },
    ...over,
  });
  const disc = (over: Record<string, unknown> = {}) => ({
    type: 'discover.source',
    id: 'my-discover',
    name: '我的榜单',
    sections: [sec()],
    ...over,
  });

  it('合法声明通过（多分区）', () => {
    expect(validateDiscoverSourceContribute(disc({ sections: [sec(), sec({ id: 'my-top-tv', mediaType: 'tv' })] }))).toEqual({ ok: true });
  });

  it('缺 id/name/sections、sections 空 → DISCOVER_PROVIDER_INVALID', () => {
    expect(validateDiscoverSourceContribute(disc({ id: 'AB' })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ name: ' ' })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ sections: [] })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ sections: 'x' })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ nope: 1 })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
  });

  it('同插件内 section.id 重复 / 字段越界 → DISCOVER_PROVIDER_INVALID', () => {
    expect(validateDiscoverSourceContribute(disc({ sections: [sec(), sec()] })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ id: 'AB' })] })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ title: ' ' })] })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ mediaType: 'variety' })] })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ nope: 1 })] })).reasonCode).toBe('DISCOVER_PROVIDER_INVALID');
  });

  it('★ v1 的 map 不许含 doubanId（会错配豆瓣剧照图源）', () => {
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ map: { title: 'n', doubanId: 'id' } })] })).reasonCode)
      .toBe('DISCOVER_PROVIDER_INVALID');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ map: { title: 'n', rating: 'r' } })] })).reasonCode)
      .toBe('DISCOVER_PROVIDER_INVALID');
  });

  it('url / 占位符 / imageBase → BAD_PROVIDER_URL；路径 → BAD_PROVIDER_PATH', () => {
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ url: 'file:///x' })] })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ url: 'https://x/?t={keyword}' })] })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ imageBase: 'img.x' })] })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ list: 'a..b' })] })).reasonCode).toBe('BAD_PROVIDER_PATH');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ map: { title: 'a..b' } })] })).reasonCode).toBe('BAD_PROVIDER_PATH');
    expect(validateDiscoverSourceContribute(disc({ sections: [sec({ map: { year: 'y' } })] })).reasonCode).toBe('BAD_PROVIDER_PATH');
  });

  it('整单走通：L2 asset', () => {
    const m = base({ contributes: [disc()] as PluginManifest['contributes'] });
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    expect(pluginLevelOf(m)).toBe('L2');
    expect(validatePluginManifest(base({ contributes: [disc({ sections: [sec({ url: 'x' })] })] as PluginManifest['contributes'] })).reasonCode)
      .toBe('BAD_PROVIDER_URL');
  });
});

describe('plugin 契约 — danmaku.source（L2 声明式弹幕源：三步链路）', () => {
  const dm = (over: Record<string, unknown> = {}) => ({
    type: 'danmaku.source',
    id: 'my-danmaku',
    name: '我的弹幕站',
    search: {
      url: 'https://dm.example.com/api/search?keyword={keyword}&season={season}',
      list: 'animes',
      map: { animeId: 'animeId', title: 'animeTitle' },
    },
    episodes: {
      url: 'https://dm.example.com/api/bangumi/{animeId}',
      list: 'bangumi.episodes',
      map: { episodeId: 'episodeId', episodeNumber: 'episodeNumber' },
    },
    comments: { url: 'https://dm.example.com/api/comment/{episodeId}?format=xml' },
    ...over,
  });

  it('合法声明通过（三步齐备）', () => {
    expect(validateDanmakuSourceContribute(dm())).toEqual({ ok: true });
  });

  it('缺 id/name/任一段 → DANMAKU_PROVIDER_INVALID', () => {
    expect(validateDanmakuSourceContribute(dm({ id: 'AB' })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
    expect(validateDanmakuSourceContribute(dm({ name: ' ' })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
    expect(validateDanmakuSourceContribute(dm({ search: null })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
    expect(validateDanmakuSourceContribute(dm({ episodes: null })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
    expect(validateDanmakuSourceContribute(dm({ comments: null })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
    expect(validateDanmakuSourceContribute(dm({ nope: 1 })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
  });

  it('每段的必填映射字段缺失 → BAD_PROVIDER_PATH', () => {
    const s = (m: Record<string, string>) => ({ ...dm(), search: { url: 'https://x/?k={keyword}', list: 'a', map: m } });
    expect(validateDanmakuSourceContribute(s({ title: 'n' })).reasonCode).toBe('BAD_PROVIDER_PATH');
    expect(validateDanmakuSourceContribute(s({ animeId: 'a' })).reasonCode).toBe('BAD_PROVIDER_PATH');
    const e = (m: Record<string, string>) => ({ ...dm(), episodes: { url: 'https://x/{animeId}', list: 'a', map: m } });
    expect(validateDanmakuSourceContribute(e({ episodeTitle: 't' })).reasonCode).toBe('BAD_PROVIDER_PATH');
  });

  it('占位符按段白名单校验；comments 必须含 {episodeId}', () => {
    expect(validateDanmakuSourceContribute(dm({ search: { url: 'https://x/?k={episodeId}', list: 'a', map: { animeId: 'a', title: 't' } } })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateDanmakuSourceContribute(dm({ episodes: { url: 'https://x/{keyword}', list: 'a', map: { episodeId: 'e' } } })).reasonCode).toBe('BAD_PROVIDER_URL');
    expect(validateDanmakuSourceContribute(dm({ comments: { url: 'https://x/all.xml' } })).reasonCode).toBe('BAD_PROVIDER_URL');
  });

  it('映射字段越界 / 段内未知字段 → DANMAKU_PROVIDER_INVALID', () => {
    expect(validateDanmakuSourceContribute(dm({ search: { url: 'https://x/?k={keyword}', list: 'a', map: { animeId: 'a', title: 't', rating: 'r' } } })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
    expect(validateDanmakuSourceContribute(dm({ episodes: { url: 'https://x/{animeId}', list: 'a', map: { episodeId: 'e' }, format: 'json' } })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
    expect(validateDanmakuSourceContribute(dm({ comments: { url: 'https://x/{episodeId}', list: 'a' } })).reasonCode).toBe('DANMAKU_PROVIDER_INVALID');
  });

  it('整单走通：L2 asset', () => {
    const m = base({ contributes: [dm()] as PluginManifest['contributes'] });
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    expect(pluginLevelOf(m)).toBe('L2');
  });
});

describe('plugin 契约 — 示例清单校验', () => {
  it('仓库内的超分示例清单必须通过宿主契约校验', () => {
    const p = fileURLToPath(
      new URL('./fixtures/example-super-resolution.plugin.json', import.meta.url),
    );
    const m = JSON.parse(readFileSync(p, 'utf-8')) as unknown;
    const r = validatePluginManifest(m);
    expect(r).toEqual({ ok: true });
    // 四档位（效率/质量/通用/高质量）都在
    expect(shaderModes((m as PluginManifest).contributes, 'mpv.shaders').map((x) => x.id))
      .toEqual(['efficiency', 'quality', 'general', 'high']);
  });

  it('★ 2026-10-18：skill 里的皮肤骨架必须通过校验（词表 / 布局枚举 / base 全对口径）', () => {
    const p = fileURLToPath(
      new URL('../../.trae/skills/winbox-plugin/assets/plugin.theme.json', import.meta.url),
    );
    const m = JSON.parse(readFileSync(p, 'utf-8')) as PluginManifest;
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    const t = themeContributeOf(m.contributes);
    expect(t).toBeTruthy();
    expect(validateThemeContribute(t)).toEqual({ ok: true });
    // 骨架必须给全 39 项词表（作者照着改就不会漏 —— 亮色皮肤漏项会露深色基线）
    expect(Object.keys(t!.tokens).sort()).toEqual(Object.keys(THEME_TOKENS).sort());
    // 声明式布局：枚举值合法
    expect(t!.layout?.shell).toBe('topbar');
  });

  it('★ 2026-10-18：skill 归档的示例皮肤包（.winbox）必须是「可安装的发布产物」', async () => {
    const p = fileURLToPath(
      new URL('../../.trae/skills/winbox-plugin/assets/theme-sakura.winbox', import.meta.url),
    );
    const entries = await extractArchiveEntries(readFileSync(p));
    const names = entries.map((e) => e.name);
    // 根级 plugin.json + LICENSE（不得多套目录层）
    expect(names).toContain('plugin.json');
    expect(names).toContain('LICENSE');
    expect(names.some((n) => n.includes('/'))).toBe(false);
    // v1 皮肤不许有任何样式表：包里出现 .css 即不合规
    expect(names.some((n) => n.toLowerCase().endsWith('.css'))).toBe(false);
    const m = JSON.parse(entries.find((e) => e.name === 'plugin.json')!.bytes.toString('utf8')) as PluginManifest;
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    expect(validateThemeContribute(themeContributeOf(m.contributes))).toEqual({ ok: true });
  });

  it('★ 2026-10-18：skill 的 assets/*.json 骨架全部必须过宿主校验（防骨架写错）', () => {
    const dir = fileURLToPath(new URL('../../.trae/skills/winbox-plugin/assets', import.meta.url));
    const files = readdirSync(dir).filter((n) => n.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const n of files) {
      const m = JSON.parse(readFileSync(join(dir, n), 'utf-8')) as PluginManifest;
      expect(validatePluginManifest(m), `${n} 未通过清单校验`).toEqual({ ok: true });
    }
  });
});

describe('plugin 契约 — live.template（L2 声明式**输出**模板）', () => {
  /** 合法最小模板：line 必须含 `{url}` */
  const lt = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'live.template',
    id: 'my-tpl',
    label: '我的模板',
    format: 'txt',
    line: '{name},{url}',
    ...over,
  });
  const inManifest = (c: unknown) =>
    validatePluginManifest(base({ contributes: [c] as unknown as PluginManifest['contributes'] }));

  it('合法最小模板通过（直校 + 清单级），m3u 多行 line 也合法', () => {
    expect(validateLiveTemplateContribute(lt())).toEqual({ ok: true });
    expect(inManifest(lt())).toEqual({ ok: true });
    const m3u = lt({
      format: 'm3u',
      header: ['#EXTM3U'],
      line: '#EXTINF:-1 group-title="{group}",{name}\n{url}',
    });
    expect(inManifest(m3u)).toEqual({ ok: true });
    expect(validateLiveTemplateContribute(lt({ group: '{group},#genre#', ext: 'txt' }))).toEqual({ ok: true });
  });

  it('line 缺 {url} → BAD_LIVE_TEMPLATE_LINE（清单级也拦）', () => {
    const c = lt({ line: '{name}' });
    expect(validateLiveTemplateContribute(c)).toMatchObject({ ok: false, reasonCode: 'BAD_LIVE_TEMPLATE_LINE' });
    expect(inManifest(c)).toMatchObject({ ok: false, reasonCode: 'BAD_LIVE_TEMPLATE_LINE' });
  });

  it('line 含空行 / 含回车 / 为空 → BAD_LIVE_TEMPLATE_LINE', () => {
    for (const line of ['{url}\n\n{name}', 'a\r\n{url}', '   ', '']) {
      expect(validateLiveTemplateContribute(lt({ line }))).toMatchObject({ ok: false, reasonCode: 'BAD_LIVE_TEMPLATE_LINE' });
    }
  });

  it('format 非 txt|m3u → LIVE_TEMPLATE_INVALID', () => {
    expect(validateLiveTemplateContribute(lt({ format: 'json' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
  });

  it('占位符越界（{foo}）→ LIVE_TEMPLATE_INVALID（line 与 header 都查）', () => {
    expect(validateLiveTemplateContribute(lt({ line: '{foo},{url}' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
    expect(validateLiveTemplateContribute(lt({ header: ['#EXTM3U {nope}'] }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
  });

  it('group 含 {url} / 含换行 → LIVE_TEMPLATE_INVALID', () => {
    expect(validateLiveTemplateContribute(lt({ group: '{group},{url}' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
    expect(validateLiveTemplateContribute(lt({ group: '{group}\n X' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
  });

  it('header 非数组 / 空数组 / 元素含换行；ext 非 [a-z0-9]{1,8} → LIVE_TEMPLATE_INVALID', () => {
    expect(validateLiveTemplateContribute(lt({ header: '#EXTM3U' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
    expect(validateLiveTemplateContribute(lt({ header: [] }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
    expect(validateLiveTemplateContribute(lt({ header: ['a\nb'] }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
    expect(validateLiveTemplateContribute(lt({ ext: '.txt' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
    expect(validateLiveTemplateContribute(lt({ ext: 'TXT' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
  });

  it('顶层未知字段 / id 非法 / label 空 → LIVE_TEMPLATE_INVALID', () => {
    expect(validateLiveTemplateContribute(lt({ url: 'https://x' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
    expect(validateLiveTemplateContribute(lt({ id: 'A' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
    expect(validateLiveTemplateContribute(lt({ label: '  ' }))).toMatchObject({ ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID' });
  });

  it('liveTemplateContributeOf 能取出贡献项（未声明 → undefined）', () => {
    const c = lt();
    const m = base({ contributes: [c] as unknown as PluginManifest['contributes'] });
    expect(liveTemplateContributeOf(m.contributes)?.id).toBe('my-tpl');
    expect(liveTemplateContributeOf(base().contributes)).toBeUndefined();
  });
});

describe('plugin 契约 — ui.command（L3 受限动作按钮，动作词表白名单）', () => {
  /** 四种动作各自的**最小合法形态** */
  const open = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'ui.command', id: 'open-site', label: '打开官网', placement: ['config'], action: 'open-url', url: 'https://example.com/', ...over,
  });
  const nav = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'ui.command', id: 'go-live', label: '去直播', placement: ['player'], action: 'navigate', to: 'live', ...over,
  });
  const ex = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'ui.command', id: 'export-txt', label: '导出直播', placement: ['config'], action: 'export-live', ...over,
  });
  const th = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'ui.command', id: 'set-dark', label: '换皮肤', placement: ['config'], action: 'set-theme', theme: 'netflix', ...over,
  });
  const inManifest = (c: unknown) =>
    validatePluginManifest(base({ contributes: [c] as unknown as PluginManifest['contributes'] }));

  it('四种动作的最小合法形态通过（直校 + 清单级）；分级为 L3', () => {
    for (const c of [open(), nav(), ex(), th()]) {
      expect(validateUiCommandContribute(c)).toEqual({ ok: true });
      expect(inManifest(c)).toEqual({ ok: true });
    }
    const m = base({ contributes: [open()] as unknown as PluginManifest['contributes'] });
    expect(pluginLevelOf(m)).toBe('L3');
  });

  it('挂载点：非数组 / 空 / 非法值 / 重复 → UI_COMMAND_INVALID', () => {
    for (const placement of ['config', [], ['desktop'], ['config', 'config']]) {
      expect(validateUiCommandContribute(open({ placement }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    }
    expect(validateUiCommandContribute(open({ placement: ['config', 'player'] }))).toEqual({ ok: true });
  });

  it('动作专属字段越界（写了别的动作才认的字段）→ UI_COMMAND_INVALID', () => {
    expect(validateUiCommandContribute(nav({ url: 'https://x.test/' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(ex({ to: 'live' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(th({ url: 'https://x.test/' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(open({ theme: 'netflix' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
  });

  it('open-url：url 非 http(s) / 含空白 / 缺失 → BAD_UI_COMMAND_URL', () => {
    for (const url of ['ftp://x.test/a', 'javascript:alert(1)', 'https://x.test/a b', '', undefined]) {
      expect(validateUiCommandContribute(open({ url }))).toMatchObject({ ok: false, reasonCode: 'BAD_UI_COMMAND_URL' });
    }
    expect(validateUiCommandContribute(open({ url: 'http://127.0.0.1:8080/x' }))).toEqual({ ok: true });
  });

  it('navigate：to 非白名单 / section 只在 to=config 且须 [a-z0-9-] → UI_COMMAND_INVALID', () => {
    expect(validateUiCommandContribute(nav({ to: 'settings' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(nav({ to: undefined }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(nav({ section: 'plugins' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(nav({ to: 'config', section: 'Plugins' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(nav({ to: 'config', section: 'plugins' }))).toEqual({ ok: true });
  });

  it('export-live：template（若写）须匹配白名单形态 → UI_COMMAND_INVALID；缺省合法', () => {
    expect(validateUiCommandContribute(ex())).toEqual({ ok: true });
    expect(validateUiCommandContribute(ex({ template: 'builtin:txt' }))).toEqual({ ok: true });
    for (const template of ['A', 'x y', ':txt', '']) {
      expect(validateUiCommandContribute(ex({ template }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    }
  });

  it('set-theme：theme 须是皮肤 id（内置或 plugin:<skinId>）→ UI_COMMAND_INVALID', () => {
    expect(validateUiCommandContribute(th({ theme: 'plugin:sakura' }))).toEqual({ ok: true });
    for (const theme of ['A', 'plugin:', 'plugin:Sakura', 'netflix x', '']) {
      expect(validateUiCommandContribute(th({ theme }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    }
  });

  it('label / title / confirm / 顶层字段 / id：边界一律 UI_COMMAND_INVALID', () => {
    expect(validateUiCommandContribute(open({ id: 'A' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(open({ label: '  ' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(open({ label: 'x'.repeat(41) }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(open({ label: 'a\nb' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(open({ title: 'x'.repeat(121) }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(open({ confirm: 'yes' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(open({ icon: 'star' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
    expect(validateUiCommandContribute(open({ action: 'run-js' }))).toMatchObject({ ok: false, reasonCode: 'UI_COMMAND_INVALID' });
  });

  it('uiCommandContributeOf 能取出贡献项（多命令时取第一个；未声明 → undefined）', () => {
    const m = base({ contributes: [open(), nav()] as unknown as PluginManifest['contributes'] });
    expect(uiCommandContributeOf(m.contributes)?.id).toBe('open-site');
    expect(uiCommandContributeOf(base().contributes)).toBeUndefined();
  });
});

describe('plugin 契约 — keymap（L3 追加快捷键；动作复用 ui.command 词表；键位硬护栏）', () => {
  /** 四种动作各自的**最小合法形态**（键位必须含 Ctrl/Alt/Meta） */
  const open = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'keymap', id: 'open-help', label: '打开帮助', scope: ['app'], key: 'Ctrl+Alt+F', action: 'open-url', url: 'https://example.com/', ...over,
  });
  const nav = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'keymap', id: 'go-live', label: '去直播', scope: ['app'], key: 'Ctrl+Alt+L', action: 'navigate', to: 'live', ...over,
  });
  const ex = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'keymap', id: 'export-txt', label: '导出直播', scope: ['player'], key: 'Ctrl+Alt+E', action: 'export-live', ...over,
  });
  const th = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'keymap', id: 'set-dark', label: '换皮肤', scope: ['app', 'player'], key: 'Ctrl+Alt+T', action: 'set-theme', theme: 'netflix', ...over,
  });
  const inManifest = (c: unknown) =>
    validatePluginManifest(base({ contributes: [c] as unknown as PluginManifest['contributes'] }));

  it('四种动作的最小合法形态通过（直校 + 清单级）；分级为 L3', () => {
    for (const c of [open(), nav(), ex(), th()]) {
      expect(validateKeymapContribute(c)).toEqual({ ok: true });
      expect(inManifest(c)).toEqual({ ok: true });
    }
    const m = base({ contributes: [open()] as unknown as PluginManifest['contributes'] });
    expect(pluginLevelOf(m)).toBe('L3');
  });

  it('scope：非数组 / 空 / 非法值 / 重复 → KEYMAP_INVALID', () => {
    for (const scope of ['app', [], ['desktop'], ['app', 'app']]) {
      expect(validateKeymapContribute(open({ scope }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    }
    expect(validateKeymapContribute(open({ scope: ['app', 'player'] }))).toEqual({ ok: true });
  });

  it('键位硬护栏：必须含 Ctrl/Alt/Meta、主键限字母/数字/F 键 → BAD_KEYMAP_KEY', () => {
    // 缺修饰键 / 仅 Shift / 未知修饰键 / 主键越界（方向键、Esc、多字符）
    for (const key of ['F', 'F1', 'Shift+F', 'Fn+F', 'Ctrl+ArrowLeft', 'Ctrl+Escape', 'Ctrl+', 'Ctrl+AB', '', undefined]) {
      expect(validateKeymapContribute(open({ key })), `key=${key}`).toMatchObject({ ok: false, reasonCode: 'BAD_KEYMAP_KEY' });
    }
    // 合法：任意顺序 / 大小写 / 别名（control/option/cmd/super/win）
    for (const key of ['Ctrl+Alt+F', 'alt+ctrl+f', 'Command+Shift+K', 'Meta+1', 'Ctrl+F12', 'option+control+G']) {
      expect(validateKeymapContribute(open({ key })), `key=${key}`).toEqual({ ok: true });
    }
  });

  it('parseKeyCombo 归一：修饰键固定顺序（Ctrl→Alt→Shift→Meta）+ 主键大写', () => {
    const p = parseKeyCombo('alt+ctrl+f');
    expect(p.ok && p.combo.canonical).toBe('Ctrl+Alt+F');
    const m = parseKeyCombo('Command+Shift+k');
    expect(m.ok && m.combo.canonical).toBe('Shift+Meta+K');
    expect(m.ok && m.combo.mods).toEqual(['Shift', 'Meta']);
    expect(m.ok && m.combo.main).toBe('K');
    expect(parseKeyCombo('Shift+F').ok).toBe(false);
  });

  it('动作专属字段越界（写了别的动作才认的字段）→ KEYMAP_INVALID', () => {
    expect(validateKeymapContribute(nav({ url: 'https://x.test/' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(ex({ to: 'live' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(th({ url: 'https://x.test/' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(open({ theme: 'netflix' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
  });

  it('open-url：url 非 http(s) / 含空白 / 缺失 → BAD_KEYMAP_URL', () => {
    for (const url of ['ftp://x.test/a', 'javascript:alert(1)', 'https://x.test/a b', '', undefined]) {
      expect(validateKeymapContribute(open({ url }))).toMatchObject({ ok: false, reasonCode: 'BAD_KEYMAP_URL' });
    }
    expect(validateKeymapContribute(open({ url: 'http://127.0.0.1:8080/x' }))).toEqual({ ok: true });
  });

  it('navigate / export-live / set-theme 的动作参数与 ui.command **同口径**（复用共用校验）', () => {
    expect(validateKeymapContribute(nav({ to: 'settings' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(nav({ section: 'plugins' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(nav({ to: 'config', section: 'plugins' }))).toEqual({ ok: true });
    expect(validateKeymapContribute(ex())).toEqual({ ok: true });
    expect(validateKeymapContribute(ex({ template: 'A' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(th({ theme: 'A' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
  });

  it('label / title / confirm / 顶层字段 / id：边界一律 KEYMAP_INVALID', () => {
    expect(validateKeymapContribute(open({ id: 'A' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(open({ label: '  ' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(open({ label: 'x'.repeat(41) }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(open({ title: 'x'.repeat(121) }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(open({ confirm: 'yes' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(open({ when: 'always' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
    expect(validateKeymapContribute(open({ action: 'run-js' }))).toMatchObject({ ok: false, reasonCode: 'KEYMAP_INVALID' });
  });

  it('keymapContributeOf 能取出贡献项（多条取第一个；未声明 → undefined）；KEYMAP_SCOPES 白名单', () => {
    const m = base({ contributes: [open(), nav()] as unknown as PluginManifest['contributes'] });
    expect(keymapContributeOf(m.contributes)?.id).toBe('open-help');
    expect(keymapContributeOf(base().contributes)).toBeUndefined();
    expect(KEYMAP_SCOPES).toEqual(['app', 'player']);
  });
});

describe('plugin 契约 — settings.panel（L3 插件设置面板；受限词汇表 4 类字段）', () => {
  const panel = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'settings.panel',
    id: 'general',
    label: '常规设置',
    fields: [{ key: 'on', label: '启用', type: 'toggle', default: true }],
    ...over,
  });
  const inManifest = (c: unknown) =>
    validatePluginManifest(base({ contributes: [c] as unknown as PluginManifest['contributes'] }));

  it('四类字段最小合法（直校 + 清单级）；分级为 L3', () => {
    const c = panel({
      fields: [
        { key: 'on', label: '启用', type: 'toggle', default: true },
        { key: 'mode', label: '模式', type: 'select', default: 'a', options: [{ value: 'a' }, { value: 'b', label: 'B' }] },
        { key: 'name', label: '名称', type: 'text', default: '', maxLength: 50, placeholder: '…' },
        { key: 'n', label: '数量', type: 'number', default: 3, min: 1, max: 9, step: 1, hint: '并发数' },
      ],
    });
    expect(validateSettingsPanelContribute(c)).toEqual({ ok: true });
    expect(inManifest(c)).toEqual({ ok: true });
    const m = base({ contributes: [panel()] as unknown as PluginManifest['contributes'] });
    expect(pluginLevelOf(m)).toBe('L3');
    expect(SETTINGS_FIELD_TYPES).toEqual(['toggle', 'select', 'text', 'number']);
  });

  it('结构边界：id / label / title / 顶层字段 / fields 空·超限 / key 重复 → SETTINGS_PANEL_INVALID', () => {
    expect(validateSettingsPanelContribute(panel({ id: 'A' }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ label: '  ' }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ title: 'x'.repeat(121) }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ when: 'always' }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ fields: [] }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    const many = Array.from({ length: 25 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: 'toggle', default: false }));
    expect(validateSettingsPanelContribute(panel({ fields: many }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    const dup = [
      { key: 'on', label: 'A', type: 'toggle', default: false },
      { key: 'on', label: 'B', type: 'toggle', default: false },
    ];
    expect(validateSettingsPanelContribute(panel({ fields: dup }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    // 字段内：未知字段 / key 非法 / label 空 / type 越界 / hint 越界
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 'on', label: 'A', type: 'toggle', default: true, foo: 1 }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 'A', label: 'A', type: 'toggle', default: true }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 'on', label: ' ', type: 'toggle', default: true }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 'on', label: 'A', type: 'slider', default: 1 }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 'on', label: 'A', type: 'toggle', default: true, hint: 'x'.repeat(121) }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
  });

  it('★ 参数必须与类型匹配（toggle 带 options、text 带 min、number 带 maxLength）→ SETTINGS_PANEL_INVALID', () => {
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 'on', label: 'A', type: 'toggle', default: true, options: [{ value: 'x' }] }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 't', label: 'A', type: 'text', default: 'x', min: 1 }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 'n', label: 'A', type: 'number', default: 1, maxLength: 5 }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(panel({ fields: [{ key: 's', label: 'A', type: 'select', default: 'a' }] })))
      .toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
  });

  it('default 与类型不匹配 → BAD_SETTINGS_DEFAULT（toggle 非布尔 / select 不在 options / text 超长 / number 越界或非数字）', () => {
    for (const f of [
      { key: 'on', label: 'A', type: 'toggle', default: 'yes' },
      { key: 'm', label: 'A', type: 'select', default: 'zzz', options: [{ value: 'a' }] },
      { key: 't', label: 'A', type: 'text', default: 'abcd', maxLength: 3 },
      { key: 't2', label: 'A', type: 'text', default: 5 },
      { key: 'n', label: 'A', type: 'number', default: 99, min: 1, max: 10 },
      { key: 'n2', label: 'A', type: 'number', default: '3' },
    ]) {
      expect(validateSettingsPanelContribute(panel({ fields: [f] })), JSON.stringify(f))
        .toMatchObject({ ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT' });
    }
  });

  it('select 的 options 边界 → SETTINGS_PANEL_INVALID（非数组/空/超 50/重复 value/value 非法/label 非法/未知字段）', () => {
    const withOpts = (options: unknown) => panel({ fields: [{ key: 's', label: 'A', type: 'select', default: 'a', options }] });
    for (const options of ['a', [], new Array(51).fill({ value: 'a' })]) {
      expect(validateSettingsPanelContribute(withOpts(options))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    }
    expect(validateSettingsPanelContribute(withOpts([{ value: 'a' }, { value: 'a' }]))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(withOpts([{ value: '' }]))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(withOpts([{ value: 'a', label: ' ' }]))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(withOpts([{ value: 'a', icon: 'x' }]))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(withOpts([{ value: 'a' }, { value: 'b' }]))).toEqual({ ok: true });
  });

  it('number 的 min>max / step<=0 / min 非数字 → SETTINGS_PANEL_INVALID；text 的 maxLength·placeholder 边界', () => {
    const num = (over: Record<string, unknown>) => panel({ fields: [{ key: 'n', label: 'A', type: 'number', default: 2, ...over }] });
    expect(validateSettingsPanelContribute(num({ min: 5, max: 1, default: 3 }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(num({ step: 0 }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(num({ min: '1' }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    const txt = (over: Record<string, unknown>) => panel({ fields: [{ key: 't', label: 'A', type: 'text', default: '', ...over }] });
    expect(validateSettingsPanelContribute(txt({ maxLength: 0 }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(txt({ maxLength: 201 }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(txt({ placeholder: 'x'.repeat(61) }))).toMatchObject({ ok: false, reasonCode: 'SETTINGS_PANEL_INVALID' });
    expect(validateSettingsPanelContribute(txt({ maxLength: 5, placeholder: 'ok' }))).toEqual({ ok: true });
  });

  it('settingsValueError / settingsEffectiveValue：值校验与「有效值回落」**共用同一判据**', () => {
    const toggle = { type: 'toggle' as const };
    const sel = { type: 'select' as const, options: [{ value: 'a' }, { value: 'b' }] };
    const num = { type: 'number' as const, min: 1, max: 10 };
    expect(settingsValueError(toggle, true)).toBeUndefined();
    expect(settingsValueError(toggle, 'yes')).toBeTruthy();
    expect(settingsValueError(sel, 'a')).toBeUndefined();
    expect(settingsValueError(sel, 'c')).toBeTruthy();
    expect(settingsValueError(num, 5)).toBeUndefined();
    expect(settingsValueError(num, 11)).toBeTruthy();
    // 有效值：合法存值 → 用存值；非法/缺失 → 回落 default
    const f = { key: 'n', label: 'N', type: 'number' as const, default: 4, min: 1, max: 10 };
    expect(settingsEffectiveValue(f, 8)).toBe(8);
    expect(settingsEffectiveValue(f, 99)).toBe(4);
    expect(settingsEffectiveValue(f, undefined)).toBe(4);
  });

  it('settingsPanelContributeOf 能取出贡献项（多面板取第一个；未声明 → undefined）', () => {
    const m = base({ contributes: [panel(), panel({ id: 'adv' })] as unknown as PluginManifest['contributes'] });
    expect(settingsPanelContributeOf(m.contributes)?.id).toBe('general');
    expect(settingsPanelContributeOf(base().contributes)).toBeUndefined();
  });
});

describe('plugin 契约 — ui.slot（L3 受限 UI 槽位；6 类受限组件，link 复用动作词表）', () => {
  const slot = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'ui.slot',
    id: 'discover-tip',
    slot: ['discover'],
    items: [{ type: 'text', text: '插件提示' }],
    ...over,
  });
  const inManifest = (c: unknown) =>
    validatePluginManifest(base({ contributes: [c] as unknown as PluginManifest['contributes'] }));

  it('6 类组件最小合法（直校 + 清单级）；分级为 L3', () => {
    const c = slot({
      items: [
        { type: 'heading', text: '本周精选' },
        { type: 'text', text: '第一行\n第二行' },
        { type: 'image', url: 'https://example.com/a.png', alt: '示例图' },
        { type: 'divider' },
        { type: 'kv', items: [{ label: '来源', value: '插件' }] },
        { type: 'link', label: '打开帮助', action: 'open-url', url: 'https://example.com/help' },
      ],
    });
    expect(validateUiSlotContribute(c)).toEqual({ ok: true });
    expect(inManifest(c)).toEqual({ ok: true });
    expect(pluginLevelOf(base({ contributes: [slot()] as unknown as PluginManifest['contributes'] }))).toBe('L3');
    expect(UI_SLOT_IDS).toEqual(['discover', 'home', 'detail', 'live', 'history', 'favorites']);
    expect(UI_SLOT_ITEM_TYPES).toEqual(['heading', 'text', 'image', 'divider', 'kv', 'link']);
  });

  it('结构边界：id / label / title / 顶层字段 / slot 空·非法·重复 / items 空·超限 → UI_SLOT_INVALID', () => {
    expect(validateUiSlotContribute(slot({ id: 'A' }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ label: '  ' }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ title: 'x'.repeat(121) }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ when: 'always' }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    for (const s of ['discover', [], ['desktop'], ['discover', 'discover']]) {
      expect(validateUiSlotContribute(slot({ slot: s }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    }
    expect(validateUiSlotContribute(slot({ slot: ['discover', 'home', 'detail', 'live', 'history', 'favorites'] }))).toEqual({ ok: true });
    expect(validateUiSlotContribute(slot({ items: [] }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    const many = Array.from({ length: 25 }, () => ({ type: 'divider' }));
    expect(validateUiSlotContribute(slot({ items: many }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
  });

  it('★ 参数必须与类型匹配（heading 带 url / divider 带 text / image 带 label / kv 缺 items）→ UI_SLOT_INVALID', () => {
    expect(validateUiSlotContribute(slot({ items: [{ type: 'heading', text: 'T', url: 'https://x.test/' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'divider', text: 'T' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'image', url: 'https://x.test/a.png', label: 'L' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'kv' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'widget', text: 'T' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'text', text: 'T', extra: 1 }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
  });

  it('heading / text 边界：heading 不含换行且 ≤80；text ≤500 且可含换行 → UI_SLOT_INVALID', () => {
    expect(validateUiSlotContribute(slot({ items: [{ type: 'heading', text: 'a\nb' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'heading', text: 'x'.repeat(81) }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'text', text: 'x'.repeat(501) }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'text', text: '   ' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'heading', text: 'x'.repeat(80) }] }))).toEqual({ ok: true });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'text', text: 'a\nb\nc' }] }))).toEqual({ ok: true });
  });

  it('image 的 url 非 http(s) → BAD_UI_SLOT_URL；alt 越界 → UI_SLOT_INVALID', () => {
    for (const url of ['ftp://x.test/a.png', 'javascript:alert(1)', 'https://x.test/a b', '', undefined]) {
      expect(validateUiSlotContribute(slot({ items: [{ type: 'image', url }] })), String(url))
        .toMatchObject({ ok: false, reasonCode: 'BAD_UI_SLOT_URL' });
    }
    expect(validateUiSlotContribute(slot({ items: [{ type: 'image', url: 'http://127.0.0.1/a.png' }] }))).toEqual({ ok: true });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'image', url: 'https://x.test/a.png', alt: 'x'.repeat(81) }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
  });

  it('kv 行边界：非数组 / 空 / 超 12 / label·value 边界 / 行内未知字段 → UI_SLOT_INVALID', () => {
    const kv = (items: unknown) => slot({ items: [{ type: 'kv', items }] });
    for (const items of ['a', [], new Array(13).fill({ label: 'a', value: 'b' })]) {
      expect(validateUiSlotContribute(kv(items))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    }
    expect(validateUiSlotContribute(kv([{ label: '  ', value: 'b' }]))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(kv([{ label: 'a', value: 'x'.repeat(201) }]))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(kv([{ label: 'a', value: 'b', icon: 'x' }]))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(kv([{ label: '来源', value: '插件' }]))).toEqual({ ok: true });
  });

  it('link：label 必填 + **复用 §5.9 动作词表**（动作缺失 / 参数越界 → INVALID，url 非法 → BAD_UI_SLOT_URL）', () => {
    const link = (over: Record<string, unknown> = {}) => slot({ items: [{ type: 'link', label: '打开', action: 'open-url', url: 'https://x.test/', ...over }] });
    expect(validateUiSlotContribute(link())).toEqual({ ok: true });
    expect(validateUiSlotContribute(link({ label: '  ' }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(link({ action: undefined }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(link({ action: 'run-js' }))).toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(link({ url: 'ftp://x.test/' }))).toMatchObject({ ok: false, reasonCode: 'BAD_UI_SLOT_URL' });
    // 与 ui.command 同口径：navigate 带 url / section 只在 to=config / export-live·set-theme 各自参数
    expect(validateUiSlotContribute(slot({ items: [{ type: 'link', label: 'L', action: 'navigate', to: 'live', url: 'https://x.test/' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'link', label: 'L', action: 'navigate', section: 'plugins' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'link', label: 'L', action: 'navigate', to: 'config', section: 'plugins' }] }))).toEqual({ ok: true });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'link', label: 'L', action: 'set-theme', theme: 'plugin:sakura', confirm: true }] }))).toEqual({ ok: true });
    expect(validateUiSlotContribute(slot({ items: [{ type: 'link', label: 'L', action: 'set-theme', theme: 'A' }] })))
      .toMatchObject({ ok: false, reasonCode: 'UI_SLOT_INVALID' });
  });

  it('uiSlotContributeOf 能取出贡献项（多槽位取第一个；未声明 → undefined）', () => {
    const m = base({ contributes: [slot(), slot({ id: 'live-tip', slot: ['live'] })] as unknown as PluginManifest['contributes'] });
    expect(uiSlotContributeOf(m.contributes)?.id).toBe('discover-tip');
    expect(uiSlotContributeOf(base().contributes)).toBeUndefined();
  });
});

// ★ 2026-10-18（R10）L4 权限契约（`kind:"code"` + permissions + permissionNotes）
describe('plugin 契约 — L4 权限（kind:"code" / permissions / permissionNotes）', () => {
  const code = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    manifestVersion: 1,
    id: 'l4-demo',
    name: 'L4 演示',
    version: '1.0.0',
    apiVersion: HOST_API_VERSION,
    kind: 'code',
    main: 'main.js',
    permissions: ['log', 'kv'],
    contributes: [],
    ...over,
  });

  it('合法 code 清单（含 main + 白名单权限）通过', () => {
    expect(validatePluginManifest(code())).toEqual({ ok: true });
  });

  it('白名单 12 项齐全，且 PermissionId 守卫只认白名单', () => {
    expect([...PERMISSIONS]).toEqual([
      'net', 'net.download', 'kv', 'settings', 'fs.plugin', 'log',
      'notify', 'clipboard.read', 'clipboard.write', 'dialog', 'player.control', 'openExternal',
    ]);
    for (const p of PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy();
    for (const p of PERMISSIONS) expect(isPermission(p)).toBe(true);
    expect(isPermission('fs')).toBe(false);
    expect(isPermission(123)).toBe(false);
  });

  it('kind=code 缺 main → PATH_ESCAPE；空 permissions → KIND_PERM_MISMATCH', () => {
    expect(validatePluginManifest(code({ main: '' })).reasonCode).toBe('PATH_ESCAPE');
    expect(validatePluginManifest(code({ main: '../x' })).reasonCode).toBe('PATH_ESCAPE');
    expect(validatePluginManifest(code({ permissions: [] })).reasonCode).toBe('KIND_PERM_MISMATCH');
  });

  it('白名单外 / 禁止项权限 → UNKNOWN_PERMISSION', () => {
    expect(validatePluginManifest(code({ permissions: ['magic'] })).reasonCode).toBe('UNKNOWN_PERMISSION');
    for (const bad of FORBIDDEN_PERMISSIONS) {
      expect(validatePluginManifest(code({ permissions: [bad] })).reasonCode, bad).toBe('UNKNOWN_PERMISSION');
    }
  });

  it('kind=asset 带 permissions → KIND_PERM_MISMATCH（既有铁律不回退）', () => {
    expect(validatePluginManifest(base({ permissions: ['log'] })).reasonCode).toBe('KIND_PERM_MISMATCH');
    expect(validatePluginManifest(base({ main: 'main.js' })).reasonCode).toBe('KIND_PERM_MISMATCH');
  });

  it('permissionNotes：合法通过；键含未声明权限 / 值含换行 / 空串 → BAD_PERMISSION_NOTES', () => {
    expect(validatePluginManifest(code({ permissionNotes: { log: '写日志', kv: '存数据' } }))).toEqual({ ok: true });
    expect(validatePluginManifest(code({ permissionNotes: { notify: '未声明' } })).reasonCode).toBe('BAD_PERMISSION_NOTES');
    expect(validatePluginManifest(code({ permissionNotes: { log: 'a\nb' } })).reasonCode).toBe('BAD_PERMISSION_NOTES');
    expect(validatePluginManifest(code({ permissionNotes: { log: '   ' } })).reasonCode).toBe('BAD_PERMISSION_NOTES');
    expect(validatePluginManifest(code({ permissionNotes: ['x'] })).reasonCode).toBe('BAD_PERMISSION_NOTES');
  });

  it('pluginLevelOf：kind=code → L4', () => {
    expect(pluginLevelOf(code() as unknown as PluginManifest)).toBe('L4');
  });
});

// ★ 2026-10-18（R11）第三方播放内核（`contributes.player.engine`；宿主托管进程）
describe('plugin 契约 — player.engine（L2 描述符：宿主托管进程，插件永不拉进程）', () => {
  /** `mpv-ipc` 族最小合法描述符 */
  const engine = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'player.engine',
    id: 'my-mpv',
    label: '我的 MPV',
    protocol: 'mpv-ipc',
    binary: { source: 'plugin-file', file: 'files/mpv.exe' },
    args: ['--wid={wid}', '--input-ipc-server={pipe}', '{url}'],
    ...over,
  });
  /** `player.engine` 只可能 `kind:"code"` ⇒ 清单级用例一律用 code 包装 */
  const inCode = (c: unknown) => validatePluginManifest({
    manifestVersion: 1, id: 'engine-pack', name: '内核插件', version: '1.0.0', apiVersion: HOST_API_VERSION,
    kind: 'code', main: 'main.js', permissions: ['log'],
    contributes: [c as PluginManifest['contributes'][number]],
  });

  it('合法描述符通过（直校 + 清单级）；分级 L4（player.engine 恒 code）', () => {
    expect(validatePlayerEngineContribute(engine())).toEqual({ ok: true });
    expect(inCode(engine())).toEqual({ ok: true });
    expect(pluginLevelOf({ kind: 'code', contributes: [engine()] as unknown as PluginManifest['contributes'] })).toBe('L4');
    expect([...PLAYER_ENGINE_PROTOCOLS]).toEqual(['mpv-ipc', 'json-lines']);
    expect([...PLAYER_ENGINE_CAPABILITIES]).toEqual(['seek', 'rate', 'tracks', 'subtitle', 'fit']);
  });

  it('★ 恒 code：asset 清单声明 player.engine → UNKNOWN_CONTRIBUTE_KIND（回退既有铁律）', () => {
    expect(validatePluginManifest(base({ contributes: [engine()] as unknown as PluginManifest['contributes'] })).reasonCode)
      .toBe('UNKNOWN_CONTRIBUTE_KIND');
  });

  it('★ 按协议分支的占位符：mpv-ipc 缺 {pipe} / json-lines 带 {pipe} → BAD_ENGINE_ARGS', () => {
    expect(validatePlayerEngineContribute(engine({ args: ['--wid={wid}', '{url}'] })))
      .toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    expect(inCode(engine({ args: ['--wid={wid}', '{url}'] })))
      .toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    const jl = engine({ protocol: 'json-lines', args: ['--wid={wid}', '{url}', '--pipe={pipe}'] });
    expect(validatePlayerEngineContribute(jl)).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    // 合法 json-lines（不带 {pipe}）
    expect(validatePlayerEngineContribute(engine({ protocol: 'json-lines', args: ['--wid={wid}', '{url}'] }))).toEqual({ ok: true });
  });

  it('binary 形态：plugin-file 缺 file 拒 / local-path 不得带 file / file 必须落在包内（安全相对名）', () => {
    expect(validatePlayerEngineContribute(engine({ binary: {} }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(engine({ binary: { source: 'local-path', file: 'x.exe' } })))
      .toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(engine({ binary: { source: 'local-path' } }))).toEqual({ ok: true });
    for (const file of ['../mpv.exe', 'C:/mpv.exe', '/usr/bin/mpv']) {
      expect(validatePlayerEngineContribute(engine({ binary: { source: 'plugin-file', file } })), file)
        .toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    }
  });

  it('playerEngineContributeOf 能取出贡献项（未声明 → undefined）', () => {
    const m = { kind: 'code' as const, contributes: [engine()] as unknown as PluginManifest['contributes'] };
    expect(playerEngineContributeOf(m.contributes)?.id).toBe('my-mpv');
    expect(playerEngineContributeOf(base().contributes)).toBeUndefined();
  });

  it('★ skill 的 player-engine 骨架必须通过校验（skill ↔ 宿主契约一致）', () => {
    const p = fileURLToPath(
      new URL('../../.trae/skills/winbox-plugin/assets/plugin.player-engine.json', import.meta.url),
    );
    const m = JSON.parse(readFileSync(p, 'utf-8')) as PluginManifest;
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    expect(m.kind).toBe('code'); // player.engine 只可能是 code 插件
    const c = playerEngineContributeOf(m.contributes);
    expect(c).toBeTruthy();
    expect(validatePlayerEngineContribute(c)).toEqual({ ok: true });
    // 骨架必须含协议必需的占位符（作者照着改就不会漏）
    const args = (c!.args ?? []).join(' ');
    for (const name of ['wid', 'pipe', 'url']) expect(args.includes(`{${name}}`), name).toBe(true);
    expect(c!.protocol).toBe('mpv-ipc');
    expect(c!.binary?.file).toContain('files/');
  });
});
