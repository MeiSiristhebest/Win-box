import { isEngineKernel, type KernelPref } from '../../../lib/kernel';
import { normalizeSpdif } from '../../../../shared/player';

/** Playback preferences are a feature model; storage and browser APIs stay behind a port. */
export interface PlayerPrefs {
  vol: number;
  rate: number;
  subOffset: number;
  fit: PlayerFit;
  kernel: KernelPref;
  spdif: string;
}

export type PlayerFit = 'contain' | 'fill' | 'cover' | 'r169' | 'r43' | 'none';

export interface PlayerPreferencesPort {
  load(): PlayerPrefs;
  save(patch: Partial<PlayerPrefs>): void;
}

export const PLAYER_FITS: ReadonlyArray<{ value: PlayerFit; label: string }> = [
  { value: 'contain', label: '适应（保持比例）' },
  { value: 'fill', label: '拉伸填满' },
  { value: 'cover', label: '裁剪填满' },
  { value: 'r169', label: '强制 16:9' },
  { value: 'r43', label: '强制 4:3' },
  { value: 'none', label: '原始尺寸' },
];

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  vol: 1,
  rate: 1,
  subOffset: 0,
  fit: 'contain',
  kernel: 'auto',
  spdif: '',
};

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeFit(value: unknown): PlayerFit {
  return PLAYER_FITS.some((fit) => fit.value === value) ? value as PlayerFit : 'contain';
}

export function normalizeKernelPref(value: unknown): KernelPref {
  if (value === 'html5' || value === 'mpv' || value === 'auto') return value;
  return isEngineKernel(value) ? value : 'auto';
}

/** Purely normalizes persisted input; malformed fields safely fall back to defaults. */
export function normalizePlayerPrefs(value: unknown): PlayerPrefs {
  const prefs = value && typeof value === 'object' ? value as Partial<PlayerPrefs> : {};
  return {
    vol: numberInRange(prefs.vol, DEFAULT_PLAYER_PREFS.vol, 0, 1),
    rate: numberInRange(prefs.rate, DEFAULT_PLAYER_PREFS.rate, 0.25, 4),
    subOffset: numberInRange(prefs.subOffset, DEFAULT_PLAYER_PREFS.subOffset, -60, 60),
    fit: normalizeFit(prefs.fit),
    kernel: normalizeKernelPref(prefs.kernel),
    spdif: normalizeSpdif(prefs.spdif),
  };
}
