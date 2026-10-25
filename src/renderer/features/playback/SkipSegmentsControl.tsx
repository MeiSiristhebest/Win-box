import { useId } from 'react';

import type { SkipSegmentsControlModel } from './presentation/PlayerControlModels';

type SkipSegmentsControlProps = SkipSegmentsControlModel;
export function SkipSegmentsControl({
  segments,
  hasSegments,
  inheritedFrom,
  draft,
  open,
  onDraftCommand,
  onToggle,
  onSave,
  onClear,
}: SkipSegmentsControlProps) {
  const panelId = useId();
  return (
    <>
      <button
        className="vp-ctl"
        type="button"
        aria-label="跳过片头片尾设置"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={
          hasSegments
            ? `跳过片头片尾：片头 ${segments.intro}s · 片尾 ${segments.outro}s（点击调整）`
            : '跳过片头片尾（点击设置）'
        }
        onClick={onToggle}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6.4v11.2L12.6 12z" fill="currentColor" />
          <path d="M12.4 6.4v11.2L21 12z" fill="currentColor" />
        </svg>
        {hasSegments && <span className="vp-subdot" />}
      </button>
      {open && (
        <div className="vp-subpanel vp-skippanel" id={panelId}>
          <div className="vsp-row">
            <span style={{ fontWeight: 600, fontSize: 12 }}>跳过片头片尾（本集）</span>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {hasSegments ? `片头 ${segments.intro}s · 片尾 ${segments.outro}s` : '未设置'}
            </span>
          </div>
          {inheritedFrom && (
            <div className="vsp-hint">
              本集未单独设置，当前沿用「{inheritedFrom}」的设置；在本集保存/清除后即不再继承。
            </div>
          )}
          <div className="vsp-row">
            <span className="muted vsp-label">片头</span>
            <input
              className="vsp-input"
              type="number"
              aria-label="片头跳过秒数"
              min={0}
              max={21600}
              placeholder="0"
              value={draft.intro}
              onChange={(event) => onDraftCommand({ type: 'change-intro', value: event.currentTarget.value })}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSave(); }}
            />
            <span className="muted" style={{ fontSize: 12 }}>秒（起播即跳到）</span>
          </div>
          <div className="vsp-row">
            <span className="muted vsp-label">片尾</span>
            <input
              className="vsp-input"
              type="number"
              aria-label="片尾跳过秒数"
              min={0}
              max={21600}
              placeholder="0"
              value={draft.outro}
              onChange={(event) => onDraftCommand({ type: 'change-outro', value: event.currentTarget.value })}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSave(); }}
            />
            <span className="muted" style={{ fontSize: 12 }}>秒（剩这么多秒跳下一集）</span>
          </div>
          <div className="vsp-row" style={{ marginBottom: 4 }}>
            <button className="vsp-btn primary" type="button" onClick={onSave}>保存到本集</button>
            <button className="vsp-btn" type="button" onClick={onClear}>清除</button>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>进度条右键可快速标点</span>
          </div>
        </div>
      )}
    </>
  );
}
