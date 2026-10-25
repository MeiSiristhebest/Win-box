import { mergeEndpoints } from '../../../../engine/danmaku/endpoints';
import type { DanmakuRegion, DanmakuSettings } from '../../../../shared/danmaku';

export type DanmakuSettingsCommand =
  | { type: 'select-region'; region: DanmakuRegion }
  | { type: 'set-font-size'; value: number }
  | { type: 'step-font-size'; delta: -2 | 2 }
  | { type: 'set-opacity'; value: number }
  | { type: 'set-density'; value: number }
  | { type: 'set-speed'; value: number }
  | { type: 'step-offset'; delta: -0.5 | 0.5 }
  | { type: 'reset-offset' }
  | { type: 'set-source-enabled'; index: number; enabled: boolean }
  | { type: 'set-all-sources-enabled'; enabled: boolean }
  | { type: 'merge-custom-endpoints'; text: string };

export type DanmakuSettingsAction = DanmakuSettingsCommand | {
  type: 'restore-settings';
  settings: DanmakuSettings;
};

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

/** Pure state transition for danmaku preferences and source selection. */
export function reduceDanmakuSettings(
  current: DanmakuSettings,
  action: DanmakuSettingsAction,
): DanmakuSettings {
  switch (action.type) {
    case 'restore-settings':
      return { ...action.settings, endpoints: action.settings.endpoints.map((endpoint) => ({ ...endpoint })) };
    case 'select-region':
      return current.region === action.region ? current : { ...current, region: action.region };
    case 'set-font-size':
      return { ...current, fontSize: clamp(action.value, 16, 40, current.fontSize) };
    case 'step-font-size':
      return { ...current, fontSize: clamp(current.fontSize + action.delta, 16, 40, current.fontSize) };
    case 'set-opacity':
      return { ...current, opacity: clamp(action.value, 0.2, 1, current.opacity) };
    case 'set-density':
      return { ...current, density: clamp(action.value, 0.25, 1, current.density) };
    case 'set-speed':
      return { ...current, speed: clamp(action.value, 50, 300, current.speed) };
    case 'step-offset':
      return { ...current, offset: current.offset + action.delta };
    case 'reset-offset':
      return current.offset === 0 ? current : { ...current, offset: 0 };
    case 'set-source-enabled': {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= current.endpoints.length) return current;
      if (current.endpoints[action.index].enabled === action.enabled) return current;
      return {
        ...current,
        endpoints: current.endpoints.map((endpoint, index) => (
          index === action.index ? { ...endpoint, enabled: action.enabled } : endpoint
        )),
      };
    }
    case 'set-all-sources-enabled':
      return {
        ...current,
        endpoints: current.endpoints.map((endpoint) => (
          endpoint.enabled === action.enabled ? endpoint : { ...endpoint, enabled: action.enabled }
        )),
      };
    case 'merge-custom-endpoints':
      return { ...current, endpoints: mergeEndpoints(current.endpoints, action.text) };
  }
}
