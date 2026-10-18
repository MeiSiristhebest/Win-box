// tests/pluginUiSlot.spec.ts — 插件受限 UI 槽位（L3 声明式 UI）适配层：
//   `contributes.ui.slot` → 宿主视图 `UiSlotView`（★ 插件不跑代码、不注入 UI；主进程只做校验 + 装配，
//   组件树渲染在渲染层 `components/PluginSlot.tsx`，link 复用动作词表执行器）。
// 覆盖：白名单字段搬运（6 类组件）/ 归属插件标注 / 可选字段不留 undefined / slot·kv 副本隔离。
import { describe, it, expect } from 'vitest';
import type { UiSlotContribute } from '../src/shared/plugin';
import { uiSlotFromContribute } from '../src/main/plugin/pluginUiSlot';

const OWNER = { id: 'my-slot-pack', name: '我的槽位插件' };

const SLOT: UiSlotContribute = {
  type: 'ui.slot',
  id: 'discover-tip',
  slot: ['discover', 'home'],
  label: '插件推荐位',
  title: '由插件提供的推荐位',
  items: [
    { type: 'heading', text: '本周精选' },
    { type: 'text', text: '第一行\n第二行' },
    { type: 'image', url: 'https://example.com/a.png', alt: '示例图' },
    { type: 'divider' },
    { type: 'kv', items: [{ label: '来源', value: '插件' }, { label: '条数', value: '12' }] },
    { type: 'link', label: '打开帮助', action: 'open-url', url: 'https://example.com/help' },
  ],
};

describe('插件受限 UI 槽位 — 适配层摊平', () => {
  it('只搬运白名单字段，并带上归属插件（6 类组件齐全）', () => {
    const v = uiSlotFromContribute(SLOT, OWNER);
    expect(v.id).toBe('discover-tip');
    expect(v.pluginId).toBe('my-slot-pack');
    expect(v.pluginName).toBe('我的槽位插件');
    expect(v.slot).toEqual(['discover', 'home']);
    expect(v.label).toBe('插件推荐位');
    expect(v.title).toBe('由插件提供的推荐位');
    expect(v.items.map((i) => i.type)).toEqual(['heading', 'text', 'image', 'divider', 'kv', 'link']);
    expect(v.items[0].text).toBe('本周精选');
    expect(v.items[1].text).toBe('第一行\n第二行');
    expect(v.items[2].url).toBe('https://example.com/a.png');
    expect(v.items[2].alt).toBe('示例图');
    expect(v.items[4].items).toEqual([{ label: '来源', value: '插件' }, { label: '条数', value: '12' }]);
    expect(v.items[5].label).toBe('打开帮助');
    expect(v.items[5].action).toBe('open-url');
    expect(v.items[5].url).toBe('https://example.com/help');
  });

  it('未声明的可选字段**不出现**在视图里（不塞 undefined / 不塞空串）', () => {
    const v = uiSlotFromContribute(SLOT, OWNER);
    expect(v as unknown as Record<string, unknown>).not.toHaveProperty('extra');
    const divider = v.items[3] as unknown as Record<string, unknown>;
    for (const k of ['text', 'url', 'alt', 'items', 'label', 'action', 'to', 'section', 'template', 'theme', 'confirm']) {
      expect(Object.prototype.hasOwnProperty.call(divider, k), `${k} 不该出现`).toBe(false);
    }
    const heading = v.items[0] as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(heading, 'url')).toBe(false);
    // 无 label / title 的贡献项也不该出现空串
    const bare = uiSlotFromContribute({ ...SLOT, label: undefined, title: undefined }, OWNER);
    expect(Object.prototype.hasOwnProperty.call(bare as unknown as Record<string, unknown>, 'label')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(bare as unknown as Record<string, unknown>, 'title')).toBe(false);
  });

  it('`slot` 与 `kv.items` 是**副本**（改视图不污染贡献项）', () => {
    const v = uiSlotFromContribute(SLOT, OWNER);
    v.slot.push('live');
    expect(SLOT.slot).toEqual(['discover', 'home']);
    v.items[4].items!.push({ label: 'x', value: 'y' });
    expect(SLOT.items[4].items).toHaveLength(2);
  });

  it('link 的导航类动作（navigate 带 section / set-theme）字段各归其位', () => {
    const nav = uiSlotFromContribute(
      { type: 'ui.slot', id: 'go-plugins', slot: ['detail'], items: [{ type: 'link', label: '插件设置', action: 'navigate', to: 'config', section: 'plugins' }] },
      OWNER,
    );
    expect(nav.items[0].to).toBe('config');
    expect(nav.items[0].section).toBe('plugins');
    const theme = uiSlotFromContribute(
      { type: 'ui.slot', id: 'to-sakura', slot: ['live'], items: [{ type: 'link', label: '樱花皮肤', action: 'set-theme', theme: 'plugin:sakura', confirm: true }] },
      OWNER,
    );
    expect(theme.items[0].theme).toBe('plugin:sakura');
    expect(theme.items[0].confirm).toBe(true);
  });
});
