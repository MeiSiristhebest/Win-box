import { resolveKernel, type Kernel, type KernelOptions, type KernelPref } from '../../../lib/kernel';

export interface PlayerKernelDecisionInput {
  allowMpv: boolean;
  preference: KernelPref;
  url: string;
  mpvStatusResolved: boolean;
  mpvAvailable: boolean;
  engines: KernelOptions['engines'];
  requiresCompatibility: boolean;
}

export interface PlayerKernelDecision {
  desiredKernel: Kernel;
  htmlPlaybackReady: boolean;
}

/**
 * Resolve the active playback engine and whether HTML probing may start.
 * Automatic mode waits for the MPV capability probe so an opaque source is not
 * needlessly transcoded before the compatibility engine can be selected.
 */
export function resolvePlayerKernelDecision(input: PlayerKernelDecisionInput): PlayerKernelDecision {
  const desiredKernel = input.allowMpv
    ? resolveKernel(input.preference, input.url, {
      mpvAvailable: input.mpvAvailable,
      engines: input.engines,
      requiresCompatibility: input.requiresCompatibility,
    })
    : 'html5';

  const htmlPlaybackReady = !input.allowMpv || (
    (input.mpvStatusResolved || input.preference === 'html5') && desiredKernel === 'html5'
  );

  return { desiredKernel, htmlPlaybackReady };
}
