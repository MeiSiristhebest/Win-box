// src/main/plugin/pluginUiCommand.ts
// 插件受限动作按钮适配层：把 `contributes.ui.command`（L2 **声明式**）摊平成宿主视图 `UiCommandView`。
//
// ★ 与 R2~R5 的 provider **完全不同**：本类型**不取数、不发请求**，也**不跑插件代码** ——
//   它只声明「按钮（label/挂载点）+ 动作（词表）」，动作的实际执行由**渲染层**按宿主预定义逻辑完成
//   （`open-url` / `navigate` / `export-live` / `set-theme`）；主进程只负责**校验 + 装配**这一层。
// 事实源：docs/design/插件制作规范.md §5.9；机器契约见 src/shared/plugin.ts。

import type { UiCommandContribute, UiCommandView } from '../../shared/plugin';

/** 归属插件（id + 显示名，用于视图的来源标注） */
export interface UiCommandOwner {
  id: string;
  name: string;
}

/** 声明式贡献 → 视图（★ 只搬运白名单字段，不额外加工） */
export function uiCommandFromContribute(c: UiCommandContribute, owner: UiCommandOwner): UiCommandView {
  return {
    id: c.id,
    pluginId: owner.id,
    pluginName: owner.name,
    label: c.label,
    ...(c.title != null ? { title: c.title } : {}),
    placement: [...c.placement],
    action: c.action,
    ...(c.url != null ? { url: c.url } : {}),
    ...(c.to != null ? { to: c.to } : {}),
    ...(c.section != null ? { section: c.section } : {}),
    ...(c.template != null ? { template: c.template } : {}),
    ...(c.theme != null ? { theme: c.theme } : {}),
    ...(c.confirm != null ? { confirm: c.confirm } : {}),
  };
}
