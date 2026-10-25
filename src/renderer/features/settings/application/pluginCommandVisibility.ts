import type { UiCommandView } from '../../../../shared/plugin';

export function selectPluginCommandsByPlacement(
  commands: readonly UiCommandView[] | undefined,
  placement: 'config' | 'player',
): UiCommandView[] {
  return (commands ?? []).filter((command) => Array.isArray(command.placement) && command.placement.includes(placement));
}
