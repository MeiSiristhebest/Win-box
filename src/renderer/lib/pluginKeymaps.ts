import { isNativeModalOpen } from './modalScope';
// src/renderer/lib/pluginKeymaps.ts
// 插件快捷键的**渲染层分发器**（唯一的键盘匹配 + 触发实现处）。
//
// ★ 与 `lib/pluginCommands.ts` 是**同一条链路**：键盘只是另一种**触发方式**，
//   命中后仍交给 `runPluginCommand`（宿主受控动作词表）执行；插件**不跑代码**。
// ★ 「不与宿主冲突」：键位在校验期已强制含 Ctrl / Alt / Meta 且主键仅限字母 / 数字 / F 键，
//   故与宿主裸键（空格 / 方向键 / Esc / Backspace）**天然不重叠**；这里再补一条「输入框中不触发」。
// 事实源：docs/design/插件制作规范.md §5.10；机器契约见 src/shared/plugin.ts。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { client } from '../api/client';
import { parseKeyCombo, type KeymapScope, type KeymapView } from '../../shared/plugin';

/** 某作用域要分发的快捷键（保持装配顺序；scope 缺失 / 不含该域 → 不分发） */
export function keymapsFor(list: KeymapView[] | undefined, scope: KeymapScope): KeymapView[] {
  return (list ?? []).filter((k) => Array.isArray(k.scope) && k.scope.includes(scope));
}

/** 键盘事件主键 → 与规范化主键比较用的形式（字母 / F 键大写；不认识的返回空） */
function mainKeyOf(e: KeyboardEvent): string {
  const k = e.key;
  if (/^[a-zA-Z]$/.test(k) || /^F\d{1,2}$/.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  return '';
}

/** 事件是否命中某键位串（大小写 / 修饰键顺序不敏感；由 `parseKeyCombo` 归一后逐项比对） */
export function keymapEventMatches(key: string, e: KeyboardEvent): boolean {
  const p = parseKeyCombo(key);
  if (!p.ok) return false;
  const { mods, main } = p.combo;
  if (e.ctrlKey !== mods.includes('Ctrl')) return false;
  if (e.altKey !== mods.includes('Alt')) return false;
  if (e.shiftKey !== mods.includes('Shift')) return false;
  if (e.metaKey !== mods.includes('Meta')) return false;
  const evMain = mainKeyOf(e);
  return evMain !== '' && evMain === main;
}

/**
 * 挂载某作用域的插件快捷键分发：拉一次列表 → 监听 `window.keydown` → 命中则 `run(hit)`。
 * `run` 由调用方给出（内部用 ref 持有，避免每次重挂监听）；**返回该作用域的键位列表**（供一览展示）。
 */
export function usePluginKeymaps(scope: KeymapScope, run: (km: KeymapView) => void): KeymapView[] {
  const [list, setList] = useState<KeymapView[]>([]);
  const listRef = useRef<KeymapView[]>([]);
  const runRef = useRef(run);
  useLayoutEffect(() => { runRef.current = run; }, [run]);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => client.pluginKeymaps())
      .then((all) => {
        if (cancelled) return;
        const inScope = keymapsFor(all, scope);
        listRef.current = inScope;
        setList(inScope);
      })
      .catch(() => undefined);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isNativeModalOpen()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const hit = listRef.current.find((k) => keymapEventMatches(k.key, e));
      if (!hit) return;
      e.preventDefault();
      runRef.current(hit);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { cancelled = true; window.removeEventListener('keydown', onKeyDown); };
  }, [scope]);
  return list;
}
