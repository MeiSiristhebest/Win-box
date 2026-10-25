import { describe, expect, it } from 'vitest';
import { DEFAULT_DANMAKU_SETTINGS } from '../src/shared/danmaku';
import { reduceDanmakuSettings } from '../src/renderer/features/playback/application/danmakuSettings';
import { reduceSubtitleAppearance } from '../src/renderer/features/playback/application/subtitleAppearance';

function freshDanmakuSettings() {
  return {
    ...DEFAULT_DANMAKU_SETTINGS,
    endpoints: DEFAULT_DANMAKU_SETTINGS.endpoints.map((endpoint) => ({ ...endpoint })),
  };
}

describe('playback settings transitions', () => {
  it('clamps danmaku settings and does not mutate the previous snapshot', () => {
    const before = freshDanmakuSettings();
    const resized = reduceDanmakuSettings(before, { type: 'set-font-size', value: 90 });
    const translucent = reduceDanmakuSettings(resized, { type: 'set-opacity', value: 0.05 });

    expect(resized.fontSize).toBe(40);
    expect(translucent.opacity).toBe(0.2);
    expect(before.fontSize).toBe(DEFAULT_DANMAKU_SETTINGS.fontSize);
    expect(before.opacity).toBe(DEFAULT_DANMAKU_SETTINGS.opacity);
  });

  it('applies source commands immutably and merges custom endpoints while preserving built-in choices', () => {
    const before = freshDanmakuSettings();
    const sourceDisabled = reduceDanmakuSettings(before, { type: 'set-source-enabled', index: 0, enabled: false });
    const withCustom = reduceDanmakuSettings(sourceDisabled, {
      type: 'merge-custom-endpoints',
      text: 'Example@https://example.invalid/danmaku',
    });

    expect(sourceDisabled.endpoints[0].enabled).toBe(false);
    expect(before.endpoints[0].enabled).toBe(true);
    expect(withCustom.endpoints[0].enabled).toBe(false);
    expect(withCustom.endpoints.some((endpoint) => endpoint.url === 'https://example.invalid/danmaku')).toBe(true);
  });

  it('restores persisted subtitle style without overwriting the session offset', () => {
    const before = { fontSize: 20, bottom: 40, offset: 1.5 };
    const restored = reduceSubtitleAppearance(before, {
      type: 'restore-persisted-style',
      fontSize: 80,
      bottom: -10,
    });
    const nudged = reduceSubtitleAppearance(restored, { type: 'step-offset', delta: -0.5 });

    expect(restored).toEqual({ fontSize: 40, bottom: 10, offset: 1.5 });
    expect(nudged.offset).toBe(1);
    expect(before).toEqual({ fontSize: 20, bottom: 40, offset: 1.5 });
  });
});
