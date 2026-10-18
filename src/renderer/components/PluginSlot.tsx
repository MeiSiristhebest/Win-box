// src/renderer/components/PluginSlot.tsx
// ★ 受限 UI 槽位渲染器（渲染层）：把宿主装配好的 `UiSlotView` 组件树渲染进宿主页面的槽位。
//
// ★ 插件**不跑代码、不注入任何 UI**（红线②）—— 这里只按**受限词汇表**的 6 类组件画**宿主样式**；
//   `link` 复用**宿主动作词表**（`runPluginCommand`，与 `ui.command` / `keymap` 同一执行器）。
// ★ 无插件声明该槽位时返回 `null` ⇒ **对既有页面零视觉/布局影响**。
// 事实源：docs/design/插件制作规范.md §5.12；机器契约见 src/shared/plugin.ts。
import { useEffect, useState } from 'react';
import { client } from '../api/client';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import type { UiSlotId, UiSlotItemView, UiSlotView } from '../../shared/plugin';
import { slotsFor } from '../lib/pluginSlots';
import { runPluginCommand } from '../lib/pluginCommands';

/** 图片一律走宿主 `/img` 中继（与内置榜单 / §5.6 发现页源同口径，防渲染层直连图床被 DNS 污染） */
function relayImg(url: string): string {
  return url.startsWith(LOCAL_PROXY_BASE) ? url : `${LOCAL_PROXY_BASE}/img?u=${encodeURIComponent(url)}`;
}

/** `link`：复用 §5.9 动作词表执行器（与按钮 / 快捷键同一套；缺 `action` → 不渲染） */
function SlotLink({ it }: { it: UiSlotItemView }) {
  if (!it.action) return null;
  return (
    <button
      type="button"
      className="linkbtn"
      title={`插件动作：${it.action}`}
      onClick={() =>
        void runPluginCommand({
          label: String(it.label ?? ''),
          action: it.action!,
          ...(it.url != null ? { url: it.url } : {}),
          ...(it.to != null ? { to: it.to } : {}),
          ...(it.section != null ? { section: it.section } : {}),
          ...(it.template != null ? { template: it.template } : {}),
          ...(it.theme != null ? { theme: it.theme } : {}),
          ...(it.confirm != null ? { confirm: it.confirm } : {}),
        })
      }
    >
      {it.label}
    </button>
  );
}

/** 单组件（6 类，宿主样式；不新增任何 CSS 类） */
function SlotItem({ it }: { it: UiSlotItemView }) {
  if (it.type === 'heading') return <div style={{ fontWeight: 600, marginBottom: 2 }}>{it.text}</div>;
  if (it.type === 'text') return <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{it.text}</div>;
  if (it.type === 'divider') {
    return <hr style={{ border: 0, borderTop: '1px solid var(--border-soft, rgba(255,255,255,.08))', margin: '6px 0' }} />;
  }
  if (it.type === 'image') {
    return (
      <img
        src={relayImg(String(it.url ?? ''))}
        alt={it.alt ?? ''}
        loading="lazy"
        decoding="async"
        style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }}
      />
    );
  }
  if (it.type === 'kv') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(it.items ?? []).map((r) => (
          <div className="row" key={`${r.label}:${r.value}`} style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 11, minWidth: 80, flex: 'none' }}>{r.label}</span>
            <span style={{ fontSize: 12 }}>{r.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return <SlotLink it={it} />;
}

/**
 * 槽位渲染器：拉一次插件槽位列表 → 取本页语义名对应的内容 → 渲染（无内容则 `null`）。
 * 用法：在宿主页面的落点写 `<PluginSlot slot="discover" />`。
 */
export default function PluginSlot({ slot }: { slot: UiSlotId }) {
  const [views, setViews] = useState<UiSlotView[]>([]);
  useEffect(() => {
    let cancelled = false;
    client
      .pluginSlots()
      .then((all) => { if (!cancelled) setViews(slotsFor(all, slot)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [slot]);
  if (!views.length) return null;
  return (
    <>
      {views.map((v) => (
        <div
          key={v.id}
          className="card"
          title={v.title || `来自插件：${v.pluginName}`}
          style={{ padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {v.label && <div className="muted" style={{ fontWeight: 600 }}>{v.label}</div>}
          {v.items.map((it, i) => <SlotItem key={`${v.id}:${i}`} it={it} />)}
        </div>
      ))}
    </>
  );
}
