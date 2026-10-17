import { themes } from '../../shared/ui/themeTokens';
import type { UiThemeId } from '../../shared/uiPreferences';

export type WindowSurfaceRole = 'application' | 'player';

export interface WindowSurfaceTarget {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
}

export function windowSurfaceColor(themeId: UiThemeId, role: WindowSurfaceRole): string | undefined {
  if (role === 'player') return undefined;
  return themes[themeId].tokens.surface;
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
