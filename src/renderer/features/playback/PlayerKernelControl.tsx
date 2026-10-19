import { useState, type RefObject } from 'react';
import type { Kernel, KernelPref } from '../../lib/kernel';
import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';
import type { KernelChoice } from './usePluginPlaybackEngines';

export function PlayerKernelControl({ kernel, preference, choices, containerRef, onSelect, onOpen }: { kernel: Kernel; preference: KernelPref; choices: KernelChoice[]; containerRef: RefObject<HTMLDivElement | null>; onSelect(value: KernelPref): void; onOpen(): void }) {
  const [open, setOpen] = useState(false);
  const panelRef = usePlayerPanelPosition(open, containerRef);
  const label = choices.find(item => item.id === kernel)?.label ?? kernel;
  const options = [{ id: 'auto' as const, label: '自动选择', note: '根据资源选择内核，内置播放失败时尝试 MPV' }, ...choices];
  const activate = () => { onOpen(); setOpen(true); };
  return <div className="vp-vol" onPointerEnter={activate} onPointerLeave={() => setOpen(false)}>
    <button type="button" className={'vp-ctl vp-kernel' + (kernel !== 'html5' ? ' vp-on' : '')} title={(preference === 'auto' ? '自动选择；当前内核：' : '当前内核：') + label} aria-expanded={open} onClick={activate}><span className="vp-kernel-tag">{preference === 'auto' ? '自动' : kernel === 'html5' ? '内置' : kernel === 'mpv' ? 'MPV' : '插件'}</span></button>
    {open && <div className="vp-fithost open"><div ref={panelRef} className="vp-subpanel vp-fitpanel"><div className="vsp-row"><span className="muted">播放内核</span></div><div className="vsp-fits">{options.map(item => <button type="button" key={item.id} className={'vsp-btn' + (preference === item.id ? ' active' : '')} title={item.note} aria-pressed={preference === item.id} onClick={() => { onSelect(item.id); setOpen(false); }}>{item.label}</button>)}</div></div></div>}
  </div>;
}
