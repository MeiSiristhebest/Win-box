// src/main/plugin/pluginUiSlot.ts
// 插件受限 UI 槽位适配层：把 `contributes.ui.slot`（L3 **声明式**）摊平成宿主视图 `UiSlotView`。
//
// ★ 与 R6~R8 的 UI 类同口径：插件**不跑代码、不注入任何 UI**（红线②）—— 本层只搬运白名单字段；
//   组件树的**渲染**在渲染层（`components/PluginSlot.tsx`），`link` 的动作由渲染层按 §5.9 词表执行。
// 事实源：docs/design/插件制作规范.md §5.12；机器契约见 src/shared/plugin.ts。

import type { UiSlotContribute, UiSlotItem, UiSlotItemView, UiSlotView } from '../../shared/plugin';

/** 归属插件（id + 显示名，用于视图的来源标注） */
export interface UiSlotOwner {
  id: string;
  name: string;
}

/** 单组件：只搬运白名单字段（不额外加工） */
function itemFromContribute(it: UiSlotItem): UiSlotItemView {
  return {
    type: it.type,
    ...(it.text != null ? { text: it.text } : {}),
    ...(it.url != null ? { url: it.url } : {}),
    ...(it.alt != null ? { alt: it.alt } : {}),
    ...(it.items != null ? { items: it.items.map((r) => ({ label: r.label, value: r.value })) } : {}),
    ...(it.label != null ? { label: it.label } : {}),
    ...(it.action != null ? { action: it.action } : {}),
    ...(it.to != null ? { to: it.to } : {}),
    ...(it.section != null ? { section: it.section } : {}),
    ...(it.template != null ? { template: it.template } : {}),
    ...(it.theme != null ? { theme: it.theme } : {}),
    ...(it.confirm != null ? { confirm: it.confirm } : {}),
  };
}

/** 声明式贡献 → 视图（★ 只搬运白名单字段） */
export function uiSlotFromContribute(c: UiSlotContribute, owner: UiSlotOwner): UiSlotView {
  return {
    id: c.id,
    pluginId: owner.id,
    pluginName: owner.name,
    slot: [...c.slot],
    ...(c.label != null ? { label: c.label } : {}),
    ...(c.title != null ? { title: c.title } : {}),
    items: c.items.map(itemFromContribute),
  };
}
