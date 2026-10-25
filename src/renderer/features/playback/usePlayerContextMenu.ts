import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { isNativeModalOpen } from '../../lib/modalScope';
import type { PlayerClipboardPort } from './application/playerClipboard';

export type PlayerContextMenuPosition = { x: number; y: number };

export function usePlayerContextMenu(mini: boolean, url: string, episodeUrl: string | undefined, showToast: (text: string) => void, clipboard: PlayerClipboardPort) {
  const [position, setPosition] = useState<PlayerContextMenuPosition | null>(null);
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
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPosition(null);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [position]);

  const handleContextMenu = (event: MouseEvent) => {
    if (mini || event.defaultPrevented || isNativeModalOpen()) return;
    event.preventDefault();
    setPosition({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 152)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 124)),
    });
  };

  const closeMenu = () => setPosition(null);
  const toggleInfo = () => setInfoOpen(value => !value);
  const copyAddress = async () => {
    const text = episodeUrl && /^[a-z][a-z0-9+.-]*:/i.test(episodeUrl) ? episodeUrl : url.trim();
    if (!text) return;
    try {
      await clipboard.writeText(text);
      showToast('视频地址已复制');
    } catch {
      showToast('无法复制视频地址');
    }
  };

  return { position, menuRef, infoOpen, handleContextMenu, closeMenu, toggleInfo, copyAddress };
}
