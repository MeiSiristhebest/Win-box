// tests/theme.spec.ts — 皮肤注册表（内置 4 套 + 插件皮肤）值层归一
// 只测纯值层 themeTokens（不引 DOM，主 tsconfig 可安全包含本测试）
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME, allSkins, normalizeTheme, registerPluginSkins, skinBase, skinLayout, THEME_LABELS,
} from '../src/renderer/lib/themeTokens';
import type { ThemeSkinView } from '../src/shared/plugin';

describe('normalizeTheme', () => {
  it('合法主题原样返回（netflix / bilibili / apple / douban）', () => {
    expect(normalizeTheme('netflix')).toBe('netflix');
    expect(normalizeTheme('bilibili')).toBe('bilibili');
    expect(normalizeTheme('apple')).toBe('apple');
    expect(normalizeTheme('douban')).toBe('douban');
  });

  it('★ 2026-09-30：已删除的经典主题（dark / light）与非法/空 → 回退默认皮肤（网飝）', () => {
    expect(DEFAULT_THEME).toBe('netflix');
    expect(normalizeTheme('dark')).toBe('netflix');
    expect(normalizeTheme('light')).toBe('netflix');
    expect(normalizeTheme('NETFLIX')).toBe('netflix');
    expect(normalizeTheme('midnight')).toBe('netflix');
    expect(normalizeTheme('')).toBe('netflix');
    expect(normalizeTheme(null)).toBe('netflix');
    expect(normalizeTheme(undefined)).toBe('netflix');
  });

  it('★ 2026-10-09：四套皮肤展示名（网飝 / 哔哔 / 大果 / 大豆）', () => {
    expect(Object.keys(THEME_LABELS).sort()).toEqual(['apple', 'bilibili', 'douban', 'netflix']);
    expect(THEME_LABELS.netflix).toContain('网飝');
    expect(THEME_LABELS.bilibili).toContain('哔哔');
    expect(THEME_LABELS.apple).toContain('大果');
    expect(THEME_LABELS.douban).toContain('大豆');
  });
});

// ★ 2026-10-18（用户要求「统一皮肤标准」）：组件不再按皮肤 id 分支，改读 layout 结构枚举 ——
//   因此注册表必须能把「内置皮肤的结构声明」与「插件皮肤的结构声明」按同一口径交出来。
describe('皮肤注册表（内置 + 插件）', () => {
  const pluginSkin = (id: string, layout: ThemeSkinView['layout'] = {}): ThemeSkinView => ({
    id, pluginId: id.slice('plugin:'.length), label: '霓虹', base: 'light',
    tokens: { '--accent': '#00e5ff' }, layout,
  });

  it('内置四套皮肤的结构声明：外壳 / 详情 / 发现 / 筛选', () => {
    const layoutOf = (id: string) => skinLayout(id);
    expect(layoutOf('netflix')).toMatchObject({ shell: 'topbar', detailStyle: 'cinema', discoverStyle: 'shelf' });
    expect(layoutOf('bilibili')).toMatchObject({ shell: 'dualbar' });
    expect(layoutOf('apple')).toMatchObject({ shell: 'sidebar', detailStyle: 'glass', discoverStyle: 'shelfWide' });
    expect(layoutOf('douban')).toMatchObject({
      shell: 'pillbar', detailStyle: 'poster', discoverStyle: 'wall', filterStyle: 'card',
    });
    // 未声明的字段回落缺省：单行顶栏 + 朴素筛选条
    expect(layoutOf('bilibili').filterStyle).toBe('plain');
    expect(skinBase('apple')).toBe('light');
    expect(skinBase('netflix')).toBe('dark');
  });

  it('插件皮肤：注册后可选中、layout 可读；未声明字段回落缺省', () => {
    try {
      // 注册前 → 未知 id 一律回落默认皮肤
      expect(normalizeTheme('plugin:neon')).toBe(DEFAULT_THEME);
      expect(skinLayout('plugin:neon').shell).toBe('topbar');

      registerPluginSkins([pluginSkin('plugin:neon', { shell: 'dualbar', discoverStyle: 'wall' })]);
      expect(normalizeTheme('plugin:neon')).toBe('plugin:neon');
      expect(skinLayout('plugin:neon')).toMatchObject({ shell: 'dualbar', discoverStyle: 'wall', filterStyle: 'plain' });
      expect(skinBase('plugin:neon')).toBe('light');
      expect(allSkins().map((s) => s.id)).toEqual(['netflix', 'bilibili', 'apple', 'douban', 'plugin:neon']);
      expect(allSkins().at(-1)?.kind).toBe('plugin');
      expect(allSkins().at(-1)?.label).toBe('霓虹');
    } finally {
      // 注册表是模块级状态 → 用例结束必须还原，避免影响其它用例
      registerPluginSkins([]);
    }
    expect(normalizeTheme('plugin:neon')).toBe(DEFAULT_THEME);
    expect(allSkins()).toHaveLength(4);
  });

  it('非法插件皮肤条目（缺 id / 缺 tokens / 重复）被丢弃', () => {
    try {
      registerPluginSkins([
        { ...pluginSkin('plugin:bad'), tokens: undefined as unknown as Record<string, string> },
        pluginSkin('plugin:dup', { shell: 'sidebar' }),
        pluginSkin('plugin:dup', { shell: 'dualbar' }),
      ]);
      expect(allSkins().filter((s) => s.kind === 'plugin').map((s) => s.id)).toEqual(['plugin:dup']);
      expect(skinLayout('plugin:dup').shell).toBe('sidebar'); // 重复 id 以先出现者为准
    } finally {
      registerPluginSkins([]);
    }
  });
});