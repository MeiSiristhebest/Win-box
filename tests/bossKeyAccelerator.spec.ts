import { describe, expect, it } from 'vitest';
import { bossKeyAcceleratorFromStroke } from '../src/renderer/features/settings/application/bossKeyAccelerator';
import { formatBossKeyAccelerator } from '../src/renderer/features/settings/presentation/bossKeyAcceleratorLabel';

describe('boss key accelerator', () => {
  it('normalizes supported modifier combinations', () => {
    expect(bossKeyAcceleratorFromStroke({ key: 'k', control: true, meta: false, alt: false, shift: true })).toBe('CommandOrControl+Shift+K');
    expect(bossKeyAcceleratorFromStroke({ key: 'F9', control: false, meta: true, alt: true, shift: false })).toBe('CommandOrControl+Alt+F9');
    expect(formatBossKeyAccelerator('CommandOrControl+Shift+K')).toBe('Ctrl + Shift + K');
  });

  it('rejects bare keys, standalone modifiers and unsupported keys', () => {
    expect(bossKeyAcceleratorFromStroke({ key: 'K', control: false, meta: false, alt: false, shift: false })).toBeNull();
    expect(bossKeyAcceleratorFromStroke({ key: 'Shift', control: true, meta: false, alt: false, shift: true })).toBeNull();
    expect(bossKeyAcceleratorFromStroke({ key: ' ', control: true, meta: false, alt: false, shift: false })).toBeNull();
  });
});
