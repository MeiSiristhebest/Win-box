import { useState, type RefObject } from 'react';
import type { Kernel } from '../../lib/kernel';
import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';
import type { KernelChoice } from './usePluginPlaybackEngines';

export function PlayerKernelControl({ kernel, choices, containerRef, onSelect, onOpen }: { kernel: Kernel; choices: KernelChoice[]; containerRef: RefObject<HTMLDivElement | null>; onSelect(value: Kernel): void; onOpen(): void }) {
  const [open, setOpen] = useState(false);
  const panelRef = usePlayerPanelPosition(open, containerRef);
  if (choices.length < 2) return null;
  const label = choices.find(item => item.id === kernel)?.label ?? kernel;
  const activate = () => { onOpen(); setOpen(true); };
  return <div className="vp-vol" onPointerEnter={activate} onPointerLeave={() => setOpen(false)}>
    <button type="button" className={'vp-ctl vp-kernel' + (kernel !== 'html5' ? ' vp-on' : '')} title={'当前内核：' + label} aria-expanded={open} onClick={() => { onOpen(); setOpen(value => !value); }}><span className="vp-kernel-tag">{kernel === 'html5' ? '内置' : kernel === 'mpv' ? 'MPV' : '插件'}</span></button>
    {open && <div className="vp-fithost open"><div ref={panelRef} className="vp-subpanel vp-fitpanel"><div className="vsp-row"><span className="muted">播放内核</span></div><div className="vsp-fits">{choices.map(item => <button type="button" key={item.id} className={'vsp-btn' + (kernel === item.id ? ' active' : '')} title={item.note} aria-pressed={kernel === item.id} onClick={() => { onSelect(item.id); setOpen(false); }}>{item.label}</button>)}</div></div></div>}
  </div>;
}
