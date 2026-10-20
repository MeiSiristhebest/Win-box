// tests/theme.spec.ts — 浅色、深色和插件外观的注册表。
// 只测纯值层 themeTokens（不引 DOM，主 tsconfig 可安全包含本测试）
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME, allSkins, normalizeTheme, registerPluginSkins, skinBase, skinLayout, THEME_LABELS,
} from '../src/renderer/lib/themeTokens';
import type { ThemeSkinView } from '../src/shared/plugin';

describe('normalizeTheme', () => {
  it('保留浅色和深色，并迁移旧主题名称', () => {
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('netflix')).toBe('dark');
    expect(normalizeTheme('bilibili')).toBe('light');
    expect(normalizeTheme('apple')).toBe('light');
    expect(normalizeTheme('douban')).toBe('light');
  });

  it('非法或空主题回退到深色', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(normalizeTheme('NETFLIX')).toBe('dark');
    expect(normalizeTheme('midnight')).toBe('dark');
    expect(normalizeTheme('')).toBe('dark');
    expect(normalizeTheme(null)).toBe('dark');
    expect(normalizeTheme(undefined)).toBe('dark');
  });

  it('只显示深色和浅色两种内置外观', () => {
    expect(Object.keys(THEME_LABELS).sort()).toEqual(['dark', 'light']);
    expect(THEME_LABELS.dark).toBe('深色');
    expect(THEME_LABELS.light).toBe('浅色');
  });
});

// ★ 2026-10-18（用户要求「统一皮肤标准」）：组件不再按皮肤 id 分支，改读 layout 结构枚举 ——
//   因此注册表必须能把「内置皮肤的结构声明」与「插件皮肤的结构声明」按同一口径交出来。
describe('皮肤注册表（内置 + 插件）', () => {
  const pluginSkin = (id: string, layout: ThemeSkinView['layout'] = {}): ThemeSkinView => ({
    id, pluginId: id.slice('plugin:'.length), label: '霓虹', base: 'light',
    tokens: { '--accent': '#00e5ff' }, layout,
  });

  it('两种内置外观和旧名称使用一致的结构声明', () => {
    const layoutOf = (id: string) => skinLayout(id);
    expect(layoutOf('dark')).toMatchObject({ shell: 'topbar', navHeight: 58, cardWidth: 156, filterStyle: 'plain' });
    expect(layoutOf('light')).toEqual(layoutOf('dark'));
    expect(layoutOf('netflix')).toEqual(layoutOf('dark'));
    expect(layoutOf('apple')).toEqual(layoutOf('light'));
    expect(layoutOf('bilibili')).toEqual(layoutOf('light'));
    expect(layoutOf('douban')).toEqual(layoutOf('light'));
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
      expect(allSkins().map((s) => s.id)).toEqual(['dark', 'light', 'plugin:neon']);
      expect(allSkins().at(-1)?.kind).toBe('plugin');
      expect(allSkins().at(-1)?.label).toBe('霓虹');
    } finally {
      // 注册表是模块级状态 → 用例结束必须还原，避免影响其它用例
      registerPluginSkins([]);
    }
    expect(normalizeTheme('plugin:neon')).toBe(DEFAULT_THEME);
    expect(allSkins()).toHaveLength(2);
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
