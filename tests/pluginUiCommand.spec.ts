// tests/pluginUiCommand.spec.ts — 插件受限动作按钮（L2 声明式 UI）适配层：
//   `contributes.ui.command` → 宿主视图 `UiCommandView`（★ 插件不跑代码；主进程只做校验 + 装配，
//   动作的真实执行在渲染层，见 src/renderer/features/plugins/application/pluginCommand.ts）。
// 覆盖：白名单字段搬运 / 归属插件标注 / 可选字段不留 undefined / placement 副本隔离。
import { describe, it, expect } from 'vitest';
import type { UiCommandContribute } from '../src/shared/plugin';
import { uiCommandFromContribute } from '../src/main/plugin/pluginUiCommand';

const OWNER = { id: 'my-cmd-pack', name: '我的命令插件' };

const OPEN_URL: UiCommandContribute = {
  type: 'ui.command',
  id: 'open-site',
  label: '打开官网',
  placement: ['config', 'player'],
  action: 'open-url',
  url: 'https://example.com/help',
};

describe('插件受限动作按钮 — 适配层摊平', () => {
  it('只搬运白名单字段，并带上归属插件（pluginName 供来源标注）', () => {
    const v = uiCommandFromContribute(OPEN_URL, OWNER);
    expect(v).toEqual({
      id: 'open-site',
      pluginId: 'my-cmd-pack',
      pluginName: '我的命令插件',
      label: '打开官网',
      placement: ['config', 'player'],
      action: 'open-url',
      url: 'https://example.com/help',
    });
  });

  it('未声明的可选字段**不出现**在视图里（不塞 undefined / 不塞空串）', () => {
    const v = uiCommandFromContribute(OPEN_URL, OWNER) as unknown as Record<string, unknown>;
    for (const k of ['title', 'to', 'section', 'template', 'theme', 'confirm']) {
      expect(Object.prototype.hasOwnProperty.call(v, k), `${k} 不该出现`).toBe(false);
    }
  });

  it('navigate 带 section / confirm 时原样搬运（语义由渲染层执行）', () => {
    const v = uiCommandFromContribute(
      { type: 'ui.command', id: 'go-plugins', label: '去插件页', placement: ['config'], action: 'navigate', to: 'config', section: 'plugins', confirm: true },
      OWNER,
    );
    expect(v.to).toBe('config');
    expect(v.section).toBe('plugins');
    expect(v.confirm).toBe(true);
    expect(v.action).toBe('navigate');
  });

  it('set-theme / export-live 的专属字段各归其位', () => {
    const t = uiCommandFromContribute(
      { type: 'ui.command', id: 'theme-dark', label: '换皮肤', placement: ['config'], action: 'set-theme', theme: 'netflix' },
      OWNER,
    );
    expect(t.theme).toBe('netflix');
    const e = uiCommandFromContribute(
      { type: 'ui.command', id: 'export-txt', label: '导出直播', placement: ['config'], action: 'export-live', template: 'builtin:txt' },
      OWNER,
    );
    expect(e.template).toBe('builtin:txt');
  });

  it('placement 是**副本**（改视图不污染贡献项 —— 装配后贡献项仍可能被再次读取）', () => {
    const src: UiCommandContribute = { ...OPEN_URL, placement: ['player'] };
    const v = uiCommandFromContribute(src, OWNER);
    v.placement.push('config');
    expect(src.placement).toEqual(['player']);
  });
});
