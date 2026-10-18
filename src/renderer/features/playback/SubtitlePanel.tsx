import type { MpvSubtitleTrack } from '../../../shared/player';
import type { Dispatch, Ref, SetStateAction } from 'react';
import { buildSearchQuery } from '../../../engine/subtitle/normalizeQuery';
import type { SubtitleCandidate } from '../../../shared/subtitle';
import { subtitleSourceLabel } from '../../lib/subtitleText';

interface SubtitlePanelProps {
  embeddedTracks?: MpvSubtitleTrack[];
  sid?: number | null;
  onSelectTrack?: (id: number) => void;
  enabled: boolean;
  open: boolean;
  activeSubtitle: string;
  fontSize: number;
  bottom: number;
  offset: number;
  query: string;
  searching: boolean;
  tokenHint: boolean;
  message: string;
  candidates: SubtitleCandidate[];
  resourceName?: string;
  panelRef: Ref<HTMLDivElement>;
  onAnchorPointerEnter: () => void;
  onAnchorPointerLeave: () => void;
  onPanelPointerEnter: () => void;
  onPanelPointerLeave: () => void;
  onToggle: () => void;
  setFontSize: Dispatch<SetStateAction<number>>;
  setBottom: Dispatch<SetStateAction<number>>;
  setOffset: Dispatch<SetStateAction<number>>;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSelectCandidate: (candidate: SubtitleCandidate) => void | Promise<void>;
}

export function SubtitlePanel({
  embeddedTracks = [], sid = null, onSelectTrack,
  enabled,
  open,
  activeSubtitle,
  fontSize,
  bottom,
  offset,
  query,
  searching,
  tokenHint,
  message,
  candidates,
  resourceName,
  panelRef,
  onAnchorPointerEnter,
  onAnchorPointerLeave,
  onPanelPointerEnter,
  onPanelPointerLeave,
  onToggle,
  setFontSize,
  setBottom,
  setOffset,
  onQueryChange,
  onSearch,
  onSelectCandidate,
}: SubtitlePanelProps) {
  return (
    <div className="vp-popup-anchor" onPointerEnter={onAnchorPointerEnter} onPointerLeave={onAnchorPointerLeave}>
      <button
        className="vp-ctl"
        title={`字幕：${enabled ? '开' : '关'}（点击开关 · 悬停调整）`}
        onClick={onToggle}
      >
        <svg width="15" height="15" viewBox="0 0 24 24">
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7 11h4M7 15h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5.5 20l-1.5 2M16 20l1.5 2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {enabled && <span className="vp-subdot" />}
      </button>
      {open && (
        <div ref={panelRef} className="vp-panelhost" onPointerEnter={onPanelPointerEnter} onPointerLeave={onPanelPointerLeave}>
          <div className="vp-subpanel">
            {onSelectTrack && <div><div className="vsp-row"><span className="muted">内置字幕轨</span></div><div className="vsp-fits"><button type="button" className="vsp-btn" onClick={() => onSelectTrack(-1)}>关闭内置字幕</button>{embeddedTracks.map((track, index) => <button type="button" key={track.id} className={'vsp-btn' + (sid === track.id ? ' active' : '')} aria-pressed={sid === track.id} onClick={() => onSelectTrack(track.id)}>{[track.lang, track.title, track.codec].filter(Boolean).join(' · ') || '字幕轨 ' + (index + 1)}</button>)}</div></div>}
            <div className="vsp-row">
              <button className={`tag ${enabled ? 'active' : ''}`} onClick={onToggle}>字幕：{enabled ? '开' : '关'}</button>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                {activeSubtitle ? `✓ ${activeSubtitle}` : '未加载字幕'}
              </span>
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">字号</span>
              <button className="vsp-btn" onClick={() => setFontSize((value) => Math.max(12, value - 2))}>A−</button>
              <input
                type="range" min={12} max={40} value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
              />
              <button className="vsp-btn" onClick={() => setFontSize((value) => Math.min(40, value + 2))}>A＋</button>
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">位置</span>
              <button className="vsp-btn" onClick={() => setBottom((value) => Math.max(10, value - 8))}>上移</button>
              <input
                type="range" min={10} max={420} value={bottom}
                onChange={(event) => setBottom(Number(event.target.value))}
                style={{ width: 90 }}
              />
              <button className="vsp-btn" onClick={() => setBottom((value) => Math.min(420, value + 8))}>下移</button>
            </div>
            <div className="vsp-row">
              <span className="muted vsp-label">时间</span>
              <button className="vsp-btn" onClick={() => setOffset((value) => value - 0.5)}>−0.5s</button>
              <span className="muted" style={{ fontSize: 11 }}>{offset >= 0 ? '+' : ''}{offset}s</span>
              <button className="vsp-btn" onClick={() => setOffset((value) => value + 0.5)}>+0.5s</button>
              <button className="vsp-btn" title="重置" onClick={() => setOffset(0)}>重置</button>
            </div>
            <div className="vsp-row" style={{ marginBottom: 6 }}>
              <input
                className="vsp-input"
                value={query}
                placeholder="剧名（可改）"
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && query.trim()) onSearch(); }}
              />
            </div>
            <div className="vsp-row">
              <button className="vsp-btn primary" disabled={searching || tokenHint} onClick={onSearch}>
                {searching ? '搜索中…' : '搜索字幕'}
              </button>
              <button className="vsp-btn" title="还原为识别到的剧名" onClick={() => onQueryChange(buildSearchQuery(resourceName || ''))}>还原</button>
            </div>
            {tokenHint && !candidates.length && (
              <div className="vsp-hint">当前没有可用的字幕源：到「配置 → 设置 → 外挂字幕」打开一个源（SubtitleCat 免 token，assrt 需自填 token）后再搜索。</div>
            )}
            {message && <div className="vsp-err">{message}</div>}
            {candidates.length > 0 && (
              <div className="vsp-list">
                {candidates.map((candidate, index) => (
                  <button key={index} className="vsp-item" onClick={() => { void onSelectCandidate(candidate); }}>
                    <span className="vsp-item-name">{candidate.subname || '无名称'}</span>
                    <span className="muted">
                      {candidate.format || ''} {candidate.lang ? `· ${candidate.lang}` : ''}
                      {candidate.provider ? ` · ${subtitleSourceLabel(candidate.provider)}` : ''}
                      {candidate.hitKeyword ? ` · 来源「${candidate.hitKeyword}」` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
