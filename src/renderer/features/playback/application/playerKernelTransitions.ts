import { isEngineKernel, type Kernel, type KernelPref } from '../../../lib/kernel';
import type { PlaybackHandoff } from './playbackHandoff';

export type PlayerFullscreenMode = 'native' | 'document';
export interface PlayerKernelWindowPort {
  documentFullscreen(): boolean;
  exitFullscreen(mode: PlayerFullscreenMode): Promise<unknown>;
}

export interface HtmlPlaybackSettings {
  volume: number;
  rate: number;
}

export interface PlayerKernelSnapshot {
  url: string;
  progressKey: string;
  kernel: Kernel;
  preference: KernelPref;
  allowMpv: boolean;
  mpvAvailable: boolean;
  live: boolean;
  nativeWindow: boolean;
  fullscreen: boolean;
  position: number;
  paused: boolean;
  hasPlaybackError: boolean;
  htmlSettings: HtmlPlaybackSettings | null;
}

export interface PlayerKernelTransitionPorts {
  window: PlayerKernelWindowPort;
  snapshot(): PlayerKernelSnapshot;
  releaseTemporaryRate(): void;
  clearAutoNext(): void;
  retryPluginEngine(): void;
  stageHandoff(handoff: PlaybackHandoff, htmlSettings: HtmlPlaybackSettings | null): void;
  activateKernel(kernel: Kernel): void;
  rememberPreference(preference: KernelPref): void;
}

/** Serializes kernel handoffs without depending on React, DOM, IPC or preference storage. */
export function createPlayerKernelTransitions(ports: PlayerKernelTransitionPorts) {
  let pending: { url: string; progressKey: string; kernel: Kernel } | null = null;
  const sameResource = (state: { url: string; progressKey: string }, other: { url: string; progressKey: string }) =>
    state.url === other.url && state.progressKey === other.progressKey;

  const request = (target: Kernel, persist: boolean, preference: KernelPref, recovering: boolean): boolean => {
    let state = ports.snapshot();
    if (pending && !sameResource(pending, state)) pending = null;
    if (pending) return pending.kernel === target;
    if (target === state.kernel) {
      if (persist) ports.rememberPreference(preference);
      return !recovering;
    }

    // Read HTML settings after releasing a temporary boost, so 1.5x is not persisted as the user's rate.
    ports.releaseTemporaryRate();
    state = ports.snapshot();
    const token = { url: state.url, progressKey: state.progressKey, kernel: target };
    pending = token;
    const handoff: PlaybackHandoff = {
      ...token,
      position: Math.max(0, Number.isFinite(state.position) ? state.position : 0),
      paused: !recovering && state.paused && !state.hasPlaybackError,
    };
    const htmlSettings = state.htmlSettings ? { ...state.htmlSettings } : null;
    ports.clearAutoNext();

    const finish = () => {
      if (pending !== token) return;
      pending = null;
      if (!sameResource(token, ports.snapshot())) return;
      if (isEngineKernel(target)) ports.retryPluginEngine();
      ports.stageHandoff(handoff, htmlSettings);
      ports.activateKernel(target);
      if (persist) ports.rememberPreference(preference);
    };
    const mode: PlayerFullscreenMode | null = (state.nativeWindow && state.fullscreen) || state.kernel !== 'html5'
      ? 'native' : ports.window.documentFullscreen() ? 'document' : null;
    if (!mode) finish();
    else {
      // Bounds restoration is best effort; a failed exit must not leave the switching lock held forever.
      try { void ports.window.exitFullscreen(mode).then(finish, finish); }
      catch { finish(); }
    }
    return true;
  };

  return {
    switchKernel: (target: Kernel, persist = true, preference: KernelPref = target): boolean => request(target, persist, preference, false),
    recoverWithKernel: (target: Kernel): boolean => request(target, false, target, true),
    recoverHtmlPlayback: (): boolean => {
      const state = ports.snapshot();
      // A requested non-HTML kernel already owns recovery; do not open another fallback player.
      if (pending && sameResource(pending, state) && pending.kernel !== 'html5') return true;
      if (!state.allowMpv || !state.mpvAvailable || state.kernel !== 'html5' || state.preference !== 'auto' || state.live) return false;
      return request('mpv', false, 'auto', true);
    },
    cancel: (): void => { pending = null; },
  };
}
