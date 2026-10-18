// src/main/plugin/pluginKeymap.ts
// 插件快捷键适配层：把 `contributes.keymap`（L3 **声明式**）摊平成宿主视图 `KeymapView`。
//
// ★ 与 R6 的 `ui.command` 是**同一套动作词表** —— 本层只搬运白名单字段，并把键位串**规范化**
//   （大小写 / 修饰键顺序 / 别名归一 → 如 `Ctrl+Alt+F`）；动作的实际执行仍在**渲染层**
//   （`lib/pluginCommands.ts` 的宿主受控动作词表）；主进程只负责**校验 + 装配**。
// 事实源：docs/design/插件制作规范.md §5.10；机器契约见 src/shared/plugin.ts。

import { parseKeyCombo, type KeymapContribute, type KeymapView } from '../../shared/plugin';

/** 归属插件（id + 显示名，用于视图的来源标注） */
export interface KeymapOwner {
  id: string;
  name: string;
}

/** 声明式贡献 → 视图（键位串归一到规范形式；★ 只搬运白名单字段，不额外加工） */
export function keymapFromContribute(c: KeymapContribute, owner: KeymapOwner): KeymapView {
  const kp = parseKeyCombo(c.key);
  return {
    id: c.id,
    pluginId: owner.id,
    pluginName: owner.name,
    label: c.label,
    ...(c.title != null ? { title: c.title } : {}),
    scope: [...c.scope],
    // 校验期已过 ⇒ 恒 ok；此处兜底保留原串（不因解析失败而崩）
    key: kp.ok ? kp.combo.canonical : String(c.key),
    action: c.action,
    ...(c.url != null ? { url: c.url } : {}),
    ...(c.to != null ? { to: c.to } : {}),
    ...(c.section != null ? { section: c.section } : {}),
    ...(c.template != null ? { template: c.template } : {}),
    ...(c.theme != null ? { theme: c.theme } : {}),
    ...(c.confirm != null ? { confirm: c.confirm } : {}),
  };
}
