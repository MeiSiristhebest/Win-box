import { describe, expect, it } from 'vitest';
import { cyclePlayerFit } from '../src/renderer/features/playback/application/playerFitCycle';
import type { PlayerFit } from '../src/renderer/features/playback/application/playerPreferences';

describe('player fit cycle policy', () => {
  const expected: Array<[PlayerFit, PlayerFit, string]> = [
    ['contain', 'cover', '铺满裁剪（去除黑边）'],
    ['cover', 'r169', '强制 16:9 比例'],
    ['r169', 'r43', '强制 4:3 比例'],
    ['r43', 'fill', '拉伸全屏填充'],
    ['fill', 'none', '原始尺寸 1:1'],
    ['none', 'contain', '适应窗口（默认等比）'],
  ];

  it.each(expected)('moves %s to %s and announces the selected fit', (current, fit, label) => {
    expect(cyclePlayerFit(current)).toEqual({ fit, notice: `画面比例：${label}` });
  });
});
