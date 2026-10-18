// src/main/plugin/pluginSettingsPanel.ts
// 插件设置面板适配层：把 `contributes.settings.panel`（L3 **声明式**）摊平成宿主视图 `SettingsPanelView`。
//
// ★ 与 R6/R7 的 UI 类同口径：本层只搬运白名单字段 + 合并**有效值**（存值合法则用存值，否则回落 `default`）；
//   表单渲染与写回在**渲染层**（`ConfigPage`），持久化在**主进程**（`PluginHost` 的设置 JsonStore）。
//   插件**不跑代码**；值的**读取面留给 L4**（`settings` 权限 / `winbox.settings`）。
// 事实源：docs/design/插件制作规范.md §5.11；机器契约见 src/shared/plugin.ts。

import {
  settingsEffectiveValue,
  type SettingsPanelContribute,
  type SettingsPanelView,
} from '../../shared/plugin';

/** 归属插件（id + 显示名，用于视图的来源标注） */
export interface SettingsPanelOwner {
  id: string;
  name: string;
}

/** 声明式贡献 → 视图（★ 只搬运白名单字段；`value` = 有效值） */
export function settingsPanelFromContribute(
  c: SettingsPanelContribute,
  owner: SettingsPanelOwner,
  stored: Record<string, unknown> | undefined,
): SettingsPanelView {
  return {
    id: c.id,
    pluginId: owner.id,
    pluginName: owner.name,
    label: c.label,
    ...(c.title != null ? { title: c.title } : {}),
    fields: c.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      value: settingsEffectiveValue(f, stored?.[f.key]),
      ...(f.options != null ? { options: f.options.map((o) => ({ ...o })) } : {}),
      ...(f.maxLength != null ? { maxLength: f.maxLength } : {}),
      ...(f.placeholder != null ? { placeholder: f.placeholder } : {}),
      ...(f.min != null ? { min: f.min } : {}),
      ...(f.max != null ? { max: f.max } : {}),
      ...(f.step != null ? { step: f.step } : {}),
      ...(f.hint != null ? { hint: f.hint } : {}),
    })),
  };
}
