// tests/pluginContract.spec.ts — 插件清单契约校验（纯函数）：
//   ① validatePluginManifest 的逐条约束（id / apiVersion / kind↔permissions / main /
//      contributes 白名单与 kind 匹配 / 运行库许可清单 / 路径安全 / updateCheckUrl）；
//   ② 分级与档位取值；
//   ③ 交叉校验：仓库内的超分示例清单必须通过宿主契约校验。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractArchiveEntries } from '../src/main/subtitle/archive';
import {
  validatePluginManifest,
  validateThemeContribute,
  themeContributeOf,
  isSafeRelPath,
  pluginLevelOf,
  shadersForMode,
  shaderModes,
  HOST_API_VERSION,
  DEP_ALLOWLIST,
  THEME_TOKENS,
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
      new URL('../.trae/skills/winbox-plugin/assets/plugin.theme.json', import.meta.url),
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
      new URL('../.trae/skills/winbox-plugin/assets/theme-sakura.winbox', import.meta.url),
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
});
