export const DEFAULT_BOSS_KEY_ACCELERATOR = 'CommandOrControl+Shift+B';

export type BossKeyStroke = {
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'Dead']);
const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete']);

export function bossKeyAcceleratorFromStroke(stroke: BossKeyStroke): string | null {
  const isLetterOrDigit = /^[A-Za-z0-9]$/.test(stroke.key);
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(stroke.key);
  if (!isLetterOrDigit && !isFunctionKey && !NAVIGATION_KEYS.has(stroke.key)) return null;
  if (MODIFIER_KEYS.has(stroke.key)) return null;

  const modifiers: string[] = [];
  if (stroke.control || stroke.meta) modifiers.push('CommandOrControl');
  if (stroke.alt) modifiers.push('Alt');
  if (stroke.shift) modifiers.push('Shift');
  if (modifiers.length === 0) return null;
  return [...modifiers, isLetterOrDigit ? stroke.key.toUpperCase() : stroke.key].join('+');
}
