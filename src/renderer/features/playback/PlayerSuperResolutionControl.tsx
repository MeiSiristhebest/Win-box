import type { RefObject } from 'react';
import type { SrState } from '../../../shared/plugin';
import { SR_MODE_LABEL, type SrMode } from '../../../shared/player';
import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';

export function PlayerSuperResolutionControl({ active, info, mode, open, containerRef, onOpen, onClose, onSelect }: {
  active: boolean; info: SrState | null; mode: SrMode; open: boolean; containerRef: RefObject<HTMLDivElement | null>;
  onOpen(): void; onClose(): void; onSelect(mode: SrMode): void;
}) {
  const panelRef = usePlayerPanelPosition(open, containerRef);
  if (!active || !info?.available) return null;
  return (
    <div className="vp-vol" onPointerEnter={onOpen} onPointerLeave={onClose}>
      <button className={'vp-ctl' + (mode !== 'off' ? ' vp-on' : '')} title="超分辨率（MPV）" aria-expanded={open} onClick={onOpen}><span className="vp-kernel-tag">超分</span></button>
      <div className={'vp-fithost' + (open ? ' open' : '')}>
        <div ref={panelRef} className="vp-subpanel vp-fitpanel vp-audiopanel">
          <div className="vsp-row"><span className="muted">超分辨率（MPV 内核实时生效）</span></div>
          <div className="vsp-fits">{['off', ...info.modes.map(item => item.id)].map(id => <button key={id} className={'vsp-btn' + (mode === id ? ' active' : '')} aria-pressed={mode === id} onClick={() => onSelect(id as SrMode)}>{SR_MODE_LABEL[id as SrMode] ?? id}</button>)}</div>
        </div>
      </div>
    </div>
  );
}
