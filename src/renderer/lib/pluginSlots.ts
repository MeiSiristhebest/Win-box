// src/renderer/lib/pluginSlots.ts
// 插件受限 UI 槽位的**渲染层筛选**（纯函数）：按页面语义名取出该槽位要显示的内容。
// 事实源：docs/design/插件制作规范.md §5.12；机器契约见 src/shared/plugin.ts。
import type { UiSlotId, UiSlotView } from '../../shared/plugin';

/** 某槽位要显示的内容（保持装配顺序；`slot` 缺失 / 不含该槽位 → 不显示） */
export function slotsFor(list: UiSlotView[] | undefined, slot: UiSlotId): UiSlotView[] {
  return (list ?? []).filter((s) => Array.isArray(s.slot) && s.slot.includes(slot));
}
