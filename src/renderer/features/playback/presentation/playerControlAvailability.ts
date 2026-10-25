import type { Kernel } from '../../../lib/kernel';

export interface PlayerControlAvailabilityInput {
  live: boolean;
  skipSegmentsUsable: boolean;
  allowMpv: boolean;
  kernel: Kernel;
  episodeCount: number;
}

export interface PlayerControlAvailability {
  progressVisible: boolean;
  skipSegmentsVisible: boolean;
  kernelSelectorVisible: boolean;
  kernelToolsVisible: boolean;
  superResolutionVisible: boolean;
  superResolutionActive: boolean;
  episodeSelectorVisible: boolean;
}

/** Pure visibility projection for playback controls; it never owns player state or I/O. */
export function resolvePlayerControlAvailability({
  live,
  skipSegmentsUsable,
  allowMpv,
  kernel,
  episodeCount,
}: PlayerControlAvailabilityInput): PlayerControlAvailability {
  const mpvActive = allowMpv && kernel === 'mpv';

  return {
    progressVisible: !live,
    skipSegmentsVisible: !live && skipSegmentsUsable,
    kernelSelectorVisible: allowMpv,
    kernelToolsVisible: mpvActive,
    superResolutionVisible: allowMpv,
    superResolutionActive: mpvActive,
    episodeSelectorVisible: Number.isFinite(episodeCount) && episodeCount > 1,
  };
}
