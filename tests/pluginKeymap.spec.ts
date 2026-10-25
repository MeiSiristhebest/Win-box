// tests/pluginKeymap.spec.ts — 插件快捷键（L3 声明式 UI）适配层：
//   `contributes.keymap` → 宿主视图 `KeymapView`（★ 插件不跑代码；主进程只做校验 + 装配 + 键位归一，
//   键盘分发与动作执行都在渲染层，见 src/renderer/features/plugins/usePluginKeymaps.ts + pluginCommands.ts）。
// 覆盖：白名单字段搬运 / 归属插件标注 / 可选字段不留 undefined / scope 副本隔离 / 键位串归一。
import { describe, it, expect } from 'vitest';
import type { KeymapContribute } from '../src/shared/plugin';
import { keymapFromContribute } from '../src/main/plugin/pluginKeymap';

const OWNER = { id: 'my-key-pack', name: '我的快捷键插件' };

const QUICK_NAV: KeymapContribute = {
  type: 'keymap',
  id: 'go-discover',
  label: '去发现页',
  scope: ['app'],
  key: 'Ctrl+Alt+F',
  action: 'navigate',
  to: 'discover',
};

describe('插件快捷键 — 适配层摊平', () => {
  it('只搬运白名单字段，并带上归属插件（pluginName 供来源标注）', () => {
    const v = keymapFromContribute(QUICK_NAV, OWNER);
    expect(v).toEqual({
      id: 'go-discover',
      pluginId: 'my-key-pack',
      pluginName: '我的快捷键插件',
      label: '去发现页',
      scope: ['app'],
      key: 'Ctrl+Alt+F',
      action: 'navigate',
      to: 'discover',
    });
  });

  it('未声明的可选字段**不出现**在视图里（不塞 undefined / 不塞空串）', () => {
    const v = keymapFromContribute(QUICK_NAV, OWNER) as unknown as Record<string, unknown>;
    for (const k of ['title', 'url', 'section', 'template', 'theme', 'confirm']) {
      expect(Object.prototype.hasOwnProperty.call(v, k), `${k} 不该出现`).toBe(false);
    }
  });

  it('键位串**归一化**（大小写 / 修饰键顺序 / 别名）后再入视图', () => {
    const v = keymapFromContribute({ ...QUICK_NAV, key: 'alt+ctrl+f' }, OWNER);
    expect(v.key).toBe('Ctrl+Alt+F');
    const m = keymapFromContribute({ ...QUICK_NAV, key: 'Command+Shift+k' }, OWNER);
    expect(m.key).toBe('Shift+Meta+K');
  });

  it('四种动作的专属字段各归其位（动作词表复用 ui.command）', () => {
    const o = keymapFromContribute(
      { type: 'keymap', id: 'open-help', label: '打开帮助', scope: ['app'], key: 'Ctrl+F1', action: 'open-url', url: 'https://example.com/help' },
      OWNER,
    );
    expect(o.url).toBe('https://example.com/help');
    const t = keymapFromContribute(
      { type: 'keymap', id: 'theme-dark', label: '换皮肤', scope: ['app', 'player'], key: 'Ctrl+Alt+1', action: 'set-theme', theme: 'plugin:sakura', confirm: true },
      OWNER,
    );
    expect(t.theme).toBe('plugin:sakura');
    expect(t.confirm).toBe(true);
    expect(t.scope).toEqual(['app', 'player']);
    const e = keymapFromContribute(
      { type: 'keymap', id: 'export-txt', label: '导出直播', scope: ['app'], key: 'Ctrl+Alt+2', action: 'export-live', template: 'builtin:txt' },
      OWNER,
    );
    expect(e.template).toBe('builtin:txt');
  });

  it('scope 是**副本**（改视图不污染贡献项 —— 装配后贡献项仍可能被再次读取）', () => {
    const src: KeymapContribute = { ...QUICK_NAV, scope: ['app'] };
    const v = keymapFromContribute(src, OWNER);
    v.scope.push('player');
    expect(src.scope).toEqual(['app']);
  });
});
