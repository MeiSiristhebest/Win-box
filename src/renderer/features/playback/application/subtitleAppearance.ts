export interface SubtitleAppearance {
  fontSize: number;
  bottom: number;
  offset: number;
}

export type SubtitleAppearanceCommand =
  | { type: 'set-font-size'; value: number }
  | { type: 'step-font-size'; delta: -2 | 2 }
  | { type: 'set-bottom'; value: number }
  | { type: 'step-bottom'; delta: -8 | 8 }
  | { type: 'step-offset'; delta: -0.5 | 0.5 }
  | { type: 'reset-offset' };

export type SubtitleAppearanceAction = SubtitleAppearanceCommand | {
  type: 'restore-persisted-style';
  fontSize: number;
  bottom: number;
};

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

/** Pure state transition for subtitle appearance and synchronization settings. */
export function reduceSubtitleAppearance(
  current: SubtitleAppearance,
  action: SubtitleAppearanceAction,
): SubtitleAppearance {
  switch (action.type) {
    case 'restore-persisted-style':
      return {
        ...current,
        fontSize: clamp(action.fontSize, 12, 40, current.fontSize),
        bottom: clamp(action.bottom, 10, 420, current.bottom),
      };
    case 'set-font-size':
      return { ...current, fontSize: clamp(action.value, 12, 40, current.fontSize) };
    case 'step-font-size':
      return { ...current, fontSize: clamp(current.fontSize + action.delta, 12, 40, current.fontSize) };
    case 'set-bottom':
      return { ...current, bottom: clamp(action.value, 10, 420, current.bottom) };
    case 'step-bottom':
      return { ...current, bottom: clamp(current.bottom + action.delta, 10, 420, current.bottom) };
    case 'step-offset':
      return { ...current, offset: current.offset + action.delta };
    case 'reset-offset':
      return current.offset === 0 ? current : { ...current, offset: 0 };
  }
}
