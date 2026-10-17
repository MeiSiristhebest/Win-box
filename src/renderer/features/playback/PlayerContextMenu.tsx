import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { isNativeModalOpen } from '../../lib/modalScope';

type Position = { x: number; y: number };
export function usePlayerContextMenu(mini: boolean, url: string, episodeUrl: string | undefined, showToast: (text: string) => void) {
  const [position, setPosition] = useState<Position | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!position) return;
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onDown = (event: globalThis.MouseEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setPosition(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (isNativeModalOpen()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setPosition(null); }
    };
    window.addEventListener('mousedown', onDown, true); window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [position]);
  const onContextMenu = (event: MouseEvent) => {
    if (mini || event.defaultPrevented || isNativeModalOpen()) return;
    event.preventDefault();
    setPosition({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 152)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 124)) });
  };
  const copy = async () => {
    const text = episodeUrl && /^[a-z][a-z0-9+.-]*:/i.test(episodeUrl) ? episodeUrl : url.trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); showToast('视频地址已复制'); }
    catch { showToast('无法复制视频地址'); }
  };
  return { position, setPosition, menuRef, infoOpen, setInfoOpen, onContextMenu, copy };
}

export function PlayerContextMenu({ position, menuRef, onInfo, onCopy }: {
  position: Position | null; menuRef: RefObject<HTMLDivElement | null>; onInfo(): void; onCopy(): void;
}) {
  if (!position) return null;
  return (
    <div ref={menuRef} className="vp-skipmenu vp-ctxmenu" style={{ left: position.x, top: position.y }} role="menu" tabIndex={-1} onContextMenu={event => event.preventDefault()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault(); event.stopPropagation();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }}>
      <button className="vp-skipmenu-item" role="menuitem" onClick={onInfo}>详情信息</button>
      <button className="vp-skipmenu-item" role="menuitem" onClick={onCopy}>复制视频地址</button>
    </div>
  );
}
