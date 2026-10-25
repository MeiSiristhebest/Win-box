export interface PlayerViewport {
  width: number;
  height: number;
}

export interface PlayerPointerPosition {
  clientX: number;
  clientY: number;
}

export interface PlayerMenuSize {
  width: number;
  height: number;
}

/** Current renderer viewport used to position transient player menus. */
export interface PlayerViewportPort {
  viewport(): PlayerViewport;
}

/** Reload capability used only after the renderer reports a recoverable playback failure. */
export interface PlayerWindowReloadPort {
  reload(): void;
}

/** Purely keeps a progress context menu inside the visible viewport. */
export function resolveProgressMenuPosition(
  pointer: PlayerPointerPosition,
  viewport: PlayerViewport,
  menu: PlayerMenuSize,
  gutter = 8,
): PlayerPointerPosition {
  const maxX = Math.max(gutter, viewport.width - menu.width - gutter);
  const maxY = Math.max(gutter, viewport.height - menu.height - gutter);
  return {
    clientX: Math.min(maxX, Math.max(gutter, pointer.clientX)),
    clientY: Math.min(maxY, Math.max(gutter, pointer.clientY)),
  };
}
