import { describe, expect, it } from 'vitest';
import {
  createDisplayPreferencesSession,
  type DisplayPreferencesPorts,
  type PosterSizing,
} from '../src/renderer/features/display/application/displayPreferences';
import type { UiScalePref, UiScaleState } from '../src/shared/uiScale';

const scaleState = (pref: UiScalePref, scale: UiScaleState['scale']): UiScaleState => ({
  pref,
  scale,
  work: { width: 1920, height: 1040 },
});

function createFakePorts(read: () => Promise<UiScaleState>) {
  let scaleChanged: ((state: UiScaleState) => void) | null = null;
  let posterSizeChanged: (() => void) | null = null;
  let posterSize: 'small' | 'medium' | 'large' = 'large';
  let writtenPreference: UiScalePref | null = null;
  const layouts: PosterSizing[] = [];
  const ports: DisplayPreferencesPorts = {
    scale: {
      read,
      async set(value) {
        writtenPreference = value;
        return scaleState(value, value === 'auto' ? 1 : Number(value) as UiScaleState['scale']);
      },
      subscribe(listener) {
        scaleChanged = listener;
        return () => { scaleChanged = null; };
      },
    },
    posterSizing: {
      readSize: () => posterSize,
      subscribe(listener) {
        posterSizeChanged = listener;
        return () => { posterSizeChanged = null; };
      },
      apply: (layout) => layouts.push(layout),
    },
  };
  return {
    ports,
    layouts,
    get writtenPreference() { return writtenPreference; },
    emitScale(state: UiScaleState) { scaleChanged?.(state); },
    setPosterSize(value: typeof posterSize) { posterSize = value; posterSizeChanged?.(); },
  };
}

describe('display preferences session', () => {
  it('keeps a newer scale event when the initial read resolves late', async () => {
    let resolveRead!: (state: UiScaleState) => void;
    const fake = createFakePorts(() => new Promise((resolve) => { resolveRead = resolve; }));
    const session = createDisplayPreferencesSession(fake.ports);
    const initialize = session.initialize();

    fake.emitScale(scaleState('1.5', 1.5));
    resolveRead(scaleState('1.25', 1.25));
    await initialize;

    expect(session.getSnapshot()).toEqual(scaleState('1.5', 1.5));
    expect(fake.layouts.at(-1)).toMatchObject({ size: 'large', width: 200 / 1.5, zoom: '1.5' });
  });

  it('persists an explicit scale and recalculates poster sizing when poster preference changes', async () => {
    const fake = createFakePorts(async () => scaleState('auto', 1));
    const session = createDisplayPreferencesSession(fake.ports);
    await session.initialize();
    await session.setScale('1.25');

    expect(fake.writtenPreference).toBe('1.25');
    expect(session.getSnapshot()).toEqual(scaleState('1.25', 1.25));
    fake.setPosterSize('small');
    expect(fake.layouts.at(-1)).toMatchObject({ size: 'small', width: 128 / 1.25, zoom: '1.25' });
  });

  it('ignores unsupported scale updates and retains the fallback when the initial read fails', async () => {
    const fake = createFakePorts(async () => { throw new Error('desktop API unavailable'); });
    const session = createDisplayPreferencesSession(fake.ports);
    await session.initialize();
    fake.emitScale({ ...scaleState('2', 2), scale: 1.1 as UiScaleState['scale'] });

    expect(session.getSnapshot()).toEqual({ pref: 'auto', scale: 1, work: { width: 0, height: 0 } });
    expect(fake.layouts.at(-1)).toMatchObject({ zoom: '1' });
    session.dispose();
  });
});
