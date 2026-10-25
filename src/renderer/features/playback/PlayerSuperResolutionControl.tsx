import type { SuperResolutionControlModel } from './presentation/PlayerControlModels';
import { SR_MODE_LABEL, type SrMode } from '../../../shared/player';
import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';

type PlayerSuperResolutionControlProps = SuperResolutionControlModel;

export function PlayerSuperResolutionControl({ visible, active, info, mode, feedback, open, containerRef, onOpen, onClose, onSelect }: PlayerSuperResolutionControlProps) {
  const panelRef = usePlayerPanelPosition(open, containerRef);
  if (!visible) return null;
  const available = active && info?.available === true;
  const modes = info?.modes ?? [];
  const title = !active
    ? '超分插件仅适用于 MPV 内核；切换到 MPV 后可使用。'
    : info === null
      ? '正在检查超分插件…'
      : info.available
        ? mode === 'off' ? '超分已关闭（MPV 内核）' : `超分档位：${SR_MODE_LABEL[mode] ?? mode}（MPV 内核）`
        : '没有可用的超分插件；请在设置的插件管理中安装并启用超分插件。';
  const statusText = feedback?.message ?? (mode === 'off'
    ? '当前关闭。选择档位后会把着色器链发送给 MPV。'
    : `已选「${SR_MODE_LABEL[mode] ?? mode}」；MPV 起播时会按此档位加载着色器。`);
  return (
    <div className="vp-vol" onPointerEnter={available ? onOpen : undefined} onPointerLeave={onClose}>
      <button type="button" className={'vp-ctl vp-kernel' + (mode !== 'off' ? ' vp-on' : '')} title={title} aria-label={title} aria-pressed={available && mode !== 'off'} disabled={!available} aria-expanded={available && open} onClick={available ? onOpen : undefined}><span className="vp-kernel-tag">超分</span></button>
      {available && <div className={'vp-fithost' + (open ? ' open' : '')}>
        <div ref={panelRef} className="vp-subpanel vp-fitpanel vp-audiopanel">
          <div className="vsp-row"><span className="muted">超分辨率（仅 MPV 内核）</span></div>
          <div className="vsp-fits">{['off', ...modes.map(item => item.id)].map(id => <button key={id} type="button" className={'vsp-btn' + (mode === id ? ' active' : '')} aria-pressed={mode === id} onClick={() => onSelect(id as SrMode)}>{SR_MODE_LABEL[id as SrMode] ?? id}</button>)}</div>
          <output className={feedback?.kind === 'error' ? 'vsp-hint err' : 'vsp-hint'} aria-live="polite" style={{ display: 'block' }}>{statusText}</output>
        </div>
      </div>}
    </div>
  );
}
