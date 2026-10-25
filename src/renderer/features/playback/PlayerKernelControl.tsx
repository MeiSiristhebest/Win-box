import type { KernelControlModel } from './presentation/PlayerControlModels';
import { useState } from 'react';
import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';
import { usePlaybackPopupKeyboard } from './usePlaybackPopupKeyboard';

type PlayerKernelControlProps = KernelControlModel;

export function PlayerKernelControl({ kernel, preference, choices, containerRef, onSelect, onOpen }: PlayerKernelControlProps) {
  const [open, setOpen] = useState(false);
  const panelRef = usePlayerPanelPosition(open, containerRef);
  const label = choices.find(item => item.id === kernel)?.label ?? kernel;
  const options = [{ id: 'auto' as const, label: '自动选择（推荐）', note: '按资源选择可用的播放方式，失败时自动尝试兼容播放' }, ...choices];
  const activate = () => { onOpen(); setOpen(true); };
  const close = () => setOpen(false);
  const { triggerRef, panelId, onKeyDown, onPointerLeave, onBlur } = usePlaybackPopupKeyboard(open, activate, close);
  return <div className="vp-vol" onPointerEnter={activate} onPointerLeave={onPointerLeave} onBlur={onBlur}>
    <button ref={triggerRef} type="button" className={'vp-ctl vp-kernel' + (kernel !== 'html5' ? ' vp-on' : '')} title={(preference === 'auto' ? '自动选择；当前：' : '当前播放方式：') + label} aria-label={`播放方式：${preference === 'auto' ? '自动选择' : label}`} aria-expanded={open} aria-controls={panelId} aria-keyshortcuts="ArrowDown" onKeyDown={onKeyDown} onClick={activate}><span className="vp-kernel-tag">{preference === 'auto' ? '自动' : kernel === 'html5' ? '标准' : kernel === 'mpv' ? '兼容' : '插件'}</span></button>
    {open && <div className="vp-fithost open"><div ref={panelRef} id={panelId} className="vp-subpanel vp-fitpanel"><div className="vsp-row"><span className="muted">播放方式</span></div><div style={{ display: 'grid', gap: 6 }}>{options.map(item => <button type="button" key={item.id} className={'vsp-btn' + (preference === item.id ? ' active' : '')} style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }} title={item.note} aria-label={item.label} aria-pressed={preference === item.id} onClick={() => { onSelect(item.id); setOpen(false); triggerRef.current?.focus(); }}><span>{item.label}</span>{item.note && <small className="muted">{item.note}</small>}</button>)}</div></div></div>}
  </div>;
}
