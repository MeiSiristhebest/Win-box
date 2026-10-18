// tests/pluginSettingsPanel.spec.ts — 插件设置面板（L3 声明式 UI）适配层：
//   `contributes.settings.panel` → 宿主视图 `SettingsPanelView`（★ 插件不跑代码；主进程只做校验 + 装配 +
//   合并**有效值**，表单渲染与写回在渲染层，持久化在主进程 PluginHost 的设置 JsonStore）。
// 覆盖：白名单字段搬运 / 归属插件标注 / 可选字段不留 undefined / **有效值回落** / options 副本隔离。
import { describe, it, expect } from 'vitest';
import type { SettingsPanelContribute } from '../src/shared/plugin';
import { settingsPanelFromContribute } from '../src/main/plugin/pluginSettingsPanel';

const OWNER = { id: 'my-settings-pack', name: '我的设置插件' };

const PANEL: SettingsPanelContribute = {
  type: 'settings.panel',
  id: 'general',
  label: '常规设置',
  title: '探针常规设置',
  fields: [
    { key: 'enabled', label: '启用增强', type: 'toggle', default: true },
    { key: 'quality', label: '画质档', type: 'select', default: 'hd', options: [{ value: 'sd', label: '标清' }, { value: 'hd' }] },
    { key: 'proxy', label: '代理地址', type: 'text', default: '', maxLength: 100, placeholder: 'http://…' },
    { key: 'threads', label: '线程数', type: 'number', default: 4, min: 1, max: 16, step: 1 },
  ],
};

describe('插件设置面板 — 适配层摊平', () => {
  it('只搬运白名单字段，并带上归属插件（无存值 → 全部用 default）', () => {
    const v = settingsPanelFromContribute(PANEL, OWNER, undefined);
    expect(v.id).toBe('general');
    expect(v.pluginId).toBe('my-settings-pack');
    expect(v.pluginName).toBe('我的设置插件');
    expect(v.label).toBe('常规设置');
    expect(v.title).toBe('探针常规设置');
    expect(v.fields.map((f) => f.key)).toEqual(['enabled', 'quality', 'proxy', 'threads']);
    expect(v.fields.map((f) => f.value)).toEqual([true, 'hd', '', 4]);
    expect(v.fields.map((f) => f.type)).toEqual(['toggle', 'select', 'text', 'number']);
    expect(v.fields[1].options).toEqual([{ value: 'sd', label: '标清' }, { value: 'hd' }]);
  });

  it('存值**合法** → 用存值；存值**非法**（类型不符 / 越界 / 不在选项）→ 回落 default', () => {
    const ok = settingsPanelFromContribute(PANEL, OWNER, { enabled: false, quality: 'sd', proxy: 'socks5://x', threads: 8 });
    expect(ok.fields.map((f) => f.value)).toEqual([false, 'sd', 'socks5://x', 8]);
    const bad = settingsPanelFromContribute(PANEL, OWNER, { enabled: 'yes', quality: '4k', proxy: 5, threads: 999 });
    expect(bad.fields.map((f) => f.value)).toEqual([true, 'hd', '', 4]);
  });

  it('未声明的可选字段**不出现**在视图里（不塞 undefined / 不塞空串）', () => {
    const v = settingsPanelFromContribute(PANEL, OWNER, undefined);
    const toggle = v.fields[0] as unknown as Record<string, unknown>;
    for (const k of ['options', 'maxLength', 'placeholder', 'min', 'max', 'step', 'hint']) {
      expect(Object.prototype.hasOwnProperty.call(toggle, k), `${k} 不该出现`).toBe(false);
    }
    expect(v.fields[2].maxLength).toBe(100);
    expect(v.fields[3].min).toBe(1);
    expect(v.fields[3].max).toBe(16);
  });

  it('options 是**副本**（改视图不污染贡献项）', () => {
    const v = settingsPanelFromContribute(PANEL, OWNER, undefined);
    v.fields[1].options![0].value = 'hacked';
    expect(PANEL.fields[1].options![0].value).toBe('sd');
  });
});
