import { normalizePosterSize, posterIntrinsicHeight, posterWidth, type PosterSize } from '../../../../shared/posterSize';
import type { UiScalePref, UiScaleState, UiScaleValue } from '../../../../shared/uiScale';

export const INITIAL_UI_SCALE_STATE: UiScaleState = {
  pref: 'auto',
  scale: 1,
  work: { width: 0, height: 0 },
};

const SUPPORTED_SCALES: readonly UiScaleValue[] = [1, 1.25, 1.5, 1.75, 2];

export interface PosterSizing {
  size: PosterSize;
  width: number;
  intrinsicHeight: number;
  gap: number;
  zoom: string;
}

export interface DisplayScalePort {
  read(): Promise<UiScaleState>;
  set(value: UiScalePref): Promise<UiScaleState>;
  subscribe(listener: (state: UiScaleState) => void): () => void;
}

export interface PosterSizingPort {
  readSize(): PosterSize;
  subscribe(listener: () => void): () => void;
  apply(sizing: PosterSizing): void;
}

export interface DisplayPreferencesPorts {
  scale: DisplayScalePort;
  posterSizing: PosterSizingPort;
}

export interface DisplayPreferencesSession {
  initialize(): Promise<void>;
  setScale(value: UiScalePref): Promise<void>;
  getSnapshot(): UiScaleState;
  getServerSnapshot(): UiScaleState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function isSupportedUiScaleState(value: UiScaleState | null | undefined): value is UiScaleState {
  return !!value && SUPPORTED_SCALES.includes(value.scale);
}

export function resolvePosterSizing(size: unknown, scale: number): PosterSizing {
  const normalizedSize = normalizePosterSize(size);
  return {
    size: normalizedSize,
    width: posterWidth(normalizedSize, scale),
    intrinsicHeight: posterIntrinsicHeight(normalizedSize, scale),
    gap: 18 / scale,
    zoom: String(scale),
  };
}

/** Coordinates scale snapshots and poster layout while keeping IPC, DOM, and React behind ports. */
export function createDisplayPreferencesSession(ports: DisplayPreferencesPorts): DisplayPreferencesSession {
  let state = INITIAL_UI_SCALE_STATE;
  let initialized = false;
  let revision = 0;
  let generation = 0;
  let stopScaleEvents: (() => void) | null = null;
  let stopPosterEvents: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const applyPosterSizing = () => ports.posterSizing.apply(resolvePosterSizing(ports.posterSizing.readSize(), state.scale));
  const acceptScale = (value: UiScaleState) => {
    if (!isSupportedUiScaleState(value)) return;
    state = value;
    revision++;
    applyPosterSizing();
    for (const notify of listeners) notify();
  };

  return {
    async initialize() {
      if (initialized) {
        applyPosterSizing();
        return;
      }
      initialized = true;
      const currentGeneration = ++generation;
      stopPosterEvents = ports.posterSizing.subscribe(applyPosterSizing);
      stopScaleEvents = ports.scale.subscribe(acceptScale);
      applyPosterSizing();
      const requestedAt = revision;
      try {
        const value = await ports.scale.read();
        if (currentGeneration === generation && requestedAt === revision) acceptScale(value);
      } catch {
        // Browser previews retain the fallback scale when the desktop API is unavailable.
      }
    },
    async setScale(value) {
      acceptScale(await ports.scale.set(value));
    },
    getSnapshot: () => state,
    getServerSnapshot: () => INITIAL_UI_SCALE_STATE,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      generation++;
      initialized = false;
      stopScaleEvents?.();
      stopPosterEvents?.();
      stopScaleEvents = null;
      stopPosterEvents = null;
    },
  };
}
