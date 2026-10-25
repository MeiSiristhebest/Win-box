import { parseKeyCombo, type KeymapScope, type KeymapView } from '../../../../shared/plugin';

/** Return only shortcuts registered for the requested host surface. */
export function keymapsFor(list: KeymapView[] | undefined, scope: KeymapScope): KeymapView[] {
  return (list ?? []).filter((keymap) => Array.isArray(keymap.scope) && keymap.scope.includes(scope));
}

function mainKeyOf(event: KeyboardEvent): string {
  const key = event.key;
  if (/^[a-zA-Z]$/.test(key) || /^F\d{1,2}$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  return '';
}

/** Compare a normalized host shortcut with a browser key event. */
export function keymapEventMatches(key: string, event: KeyboardEvent): boolean {
  const parsed = parseKeyCombo(key);
  if (!parsed.ok) return false;
  const { mods, main } = parsed.combo;
  if (event.ctrlKey !== mods.includes('Ctrl')) return false;
  if (event.altKey !== mods.includes('Alt')) return false;
  if (event.shiftKey !== mods.includes('Shift')) return false;
  if (event.metaKey !== mods.includes('Meta')) return false;
  const eventMain = mainKeyOf(event);
  return eventMain !== '' && eventMain === main;
}
