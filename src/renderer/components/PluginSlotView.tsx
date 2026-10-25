import { LOCAL_PROXY_BASE } from '../../shared/constants';
import type { UiSlotItemView, UiSlotView } from '../../shared/plugin';

interface PluginSlotViewProps {
  views: UiSlotView[];
  onAction: (item: UiSlotItemView) => void;
}

function relayImg(url: string): string {
  return url.startsWith(LOCAL_PROXY_BASE) ? url : `${LOCAL_PROXY_BASE}/img?u=${encodeURIComponent(url)}`;
}

function SlotLink({ item, onAction }: { item: UiSlotItemView; onAction: (item: UiSlotItemView) => void }) {
  if (!item.action) return null;
  return (
    <button
      type="button"
      className="linkbtn"
      title={`插件动作：${item.action}`}
      onClick={() => onAction(item)}
    >
      {item.label}
    </button>
  );
}

function SlotItem({ item, onAction }: { item: UiSlotItemView; onAction: (item: UiSlotItemView) => void }) {
  if (item.type === 'heading') return <div style={{ fontWeight: 600, marginBottom: 2 }}>{item.text}</div>;
  if (item.type === 'text') return <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{item.text}</div>;
  if (item.type === 'divider') {
    return <hr style={{ border: 0, borderTop: '1px solid var(--border-soft, rgba(255,255,255,.08))', margin: '6px 0' }} />;
  }
  if (item.type === 'image') {
    return (
      <img
        src={relayImg(String(item.url ?? ''))}
        alt={item.alt ?? ''}
        loading="lazy"
        decoding="async"
        style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }}
      />
    );
  }
  if (item.type === 'kv') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(item.items ?? []).map((row) => (
          <div className="row" key={`${row.label}:${row.value}`} style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 12, minWidth: 80, flex: 'none' }}>{row.label}</span>
            <span style={{ fontSize: 12 }}>{row.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return <SlotLink item={item} onAction={onAction} />;
}

/** Renders the host-approved, declarative plugin slot view model. */
export default function PluginSlotView({ views, onAction }: PluginSlotViewProps) {
  if (!views.length) return null;
  return (
    <>
      {views.map((view) => (
        <div
          key={view.id}
          className="card"
          title={view.title || `来自插件：${view.pluginName}`}
          style={{ padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {view.label && <div className="muted" style={{ fontWeight: 600 }}>{view.label}</div>}
          {view.items.map((item, index) => <SlotItem key={`${view.id}:${index}`} item={item} onAction={onAction} />)}
        </div>
      ))}
    </>
  );
}
