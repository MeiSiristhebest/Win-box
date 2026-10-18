import { themes, findSkin, skinBase } from '../../shared/ui/themeTokens';
import type { UiThemeId } from '../../shared/uiPreferences';

export type WindowSurfaceRole = 'application' | 'player';

export interface WindowSurfaceTarget {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
}

export function windowSurfaceColor(themeId: UiThemeId, role: WindowSurfaceRole): string | undefined {
  if (role === 'player') return undefined;
  if (Object.hasOwn(themes, themeId)) return themes[themeId].tokens.surface;
  const surface = findSkin(themeId)?.tokens?.['--surface-0'];
  return surface && /^#[a-f0-9]{6}$/i.test(surface) ? surface : skinBase(themeId) === 'light' ? '#f5f5f7' : '#000000';
}

export function applyWindowSurfacePolicy(
  target: WindowSurfaceTarget,
  themeId: UiThemeId,
  role: WindowSurfaceRole,
): void {
  const color = windowSurfaceColor(themeId, role);
  if (!color || target.isDestroyed()) return;
  target.setBackgroundColor(color);
}
