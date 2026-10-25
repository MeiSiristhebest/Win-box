import type { RefObject } from 'react';
import type { PlayerContextMenuPosition } from './usePlayerContextMenu';

export function PlayerContextMenu({ position, menuRef, onInfo, onCopy }: {
  position: PlayerContextMenuPosition | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onInfo(): void;
  onCopy(): void;
}) {
  if (!position) return null;
  return (
    <div
      ref={menuRef}
      className="vp-skipmenu vp-ctxmenu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      tabIndex={-1}
      onContextMenu={event => event.preventDefault()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        event.stopPropagation();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }}
    >
      <button className="vp-skipmenu-item" role="menuitem" onClick={onInfo}>详情信息</button>
      <button className="vp-skipmenu-item" role="menuitem" onClick={onCopy}>复制视频地址</button>
    </div>
  );
}
