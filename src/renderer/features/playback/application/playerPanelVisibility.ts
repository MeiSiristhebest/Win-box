export const PLAYER_PANEL_NAMES = [
  'subtitle',
  'danmaku',
  'fit',
  'audio',
  'superResolution',
  'skip',
  'episodes',
  'stats',
  'keys',
] as const;

export type PlayerPanelName = (typeof PLAYER_PANEL_NAMES)[number];
export type PlayerPanelVisibility = Record<PlayerPanelName, boolean>;

export type PlayerPanelVisibilityEvent =
  | { type: 'open'; panel: PlayerPanelName }
  | { type: 'toggle'; panel: PlayerPanelName }
  | { type: 'close-all' };

/** Applies the one-visible-panel policy without owning React state or panel data. */
export function transitionPlayerPanelVisibility(
  current: PlayerPanelVisibility,
  event: PlayerPanelVisibilityEvent,
): PlayerPanelVisibility {
  const next = Object.fromEntries(PLAYER_PANEL_NAMES.map((panel) => [panel, false])) as PlayerPanelVisibility;
  if (event.type === 'open') next[event.panel] = true;
  if (event.type === 'toggle') next[event.panel] = !current[event.panel];
  return next;
}
