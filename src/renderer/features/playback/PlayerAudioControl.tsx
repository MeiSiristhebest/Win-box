import type { RefObject } from 'react';
import { SPDIF_OPTIONS, spdifLabel, type MpvAudioTrack } from '../../../shared/player';
import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';
import { audioTrackLabel } from './usePlayerAudioTracks';
import { usePlayerPopupKeyboard } from '../../lib/usePlayerPopupKeyboard';

export function PlayerAudioControl({ open, tracks, aid, isMpv, containerRef, onOpen, onClose, onSelect, spdif, effectiveSpdif, onSpdifChange }: {
  spdif?: string; effectiveSpdif?: string; onSpdifChange?: (value: string) => void;
  open: boolean; tracks: MpvAudioTrack[]; aid: number | null; isMpv: boolean;
  containerRef: RefObject<HTMLDivElement | null>; onOpen(): void; onClose(): void; onSelect(track: MpvAudioTrack): void;
}) {
  const panelRef = usePlayerPanelPosition(open, containerRef);
  const { triggerRef, panelId, onKeyDown, onPointerLeave, onBlur } = usePlayerPopupKeyboard(open, onOpen, onClose);
  return (
    <div className="vp-vol" onPointerEnter={onOpen} onPointerLeave={onPointerLeave} onBlur={onBlur}>
      <button ref={triggerRef} className="vp-ctl" title="音轨（悬停选择）" aria-expanded={open} aria-controls={panelId} aria-keyshortcuts="ArrowDown" onKeyDown={onKeyDown} onClick={onOpen}>
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.2v3.6M7 7v10M11 4.4v15.2M15 7.8v8.4M19 10.2v3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        {tracks.length > 1 && <span className="vp-subdot" />}
      </button>
      <div className={'vp-fithost' + (open ? ' open' : '')}>
        <div ref={panelRef} id={panelId} className="vp-subpanel vp-fitpanel vp-audiopanel">
          <div className="vsp-row"><span className="muted">音轨（本会话内自动沿用）</span></div>
          {tracks.length ? <div className="vsp-fits">{tracks.map((track, index) => <button key={track.id} className={'vsp-btn' + (aid === track.id ? ' active' : '')} aria-pressed={aid === track.id} onClick={() => onSelect(track)}>{audioTrackLabel(track, index)}</button>)}</div>
            : <div className="vsp-row"><span className="muted">{isMpv ? '未检测到音轨' : '当前内核不支持切换音轨（可切到 MPV 内核）'}</span></div>}
          {isMpv && onSpdifChange && <div><div className="vsp-row"><span className="muted">音频直通</span></div><div className="vsp-fits">{SPDIF_OPTIONS.map(option => <button type="button" key={option.value} className={'vsp-btn' + (spdif === option.value ? ' active' : '')} title={option.hint} aria-pressed={spdif === option.value} onClick={() => onSpdifChange(option.value)}>{option.label}</button>)}</div>{effectiveSpdif !== undefined && effectiveSpdif !== spdif && <div className="vsp-hint">内核实际生效：{spdifLabel(effectiveSpdif)}</div>}</div>}
        </div>
      </div>
    </div>
  );
}
