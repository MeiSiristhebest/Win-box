import type { Kernel } from '../../../lib/kernel';

export interface PlaybackResourceIdentity {
  url: string;
  progressKey: string;
}

/** A kernel handoff belongs to one profile-scoped playback resource and target kernel. */
export interface PlaybackHandoff extends PlaybackResourceIdentity {
  kernel: Kernel;
  position: number;
  paused: boolean;
}

export type PlaybackHandoffTarget = Pick<PlaybackHandoff, 'url' | 'progressKey' | 'kernel'>;

/** Owns the single pending handoff and scopes reads/position acknowledgement to its target session. */
export interface PlaybackHandoffPort {
  stage(handoff: PlaybackHandoff): void;
  readFor(target: PlaybackHandoffTarget): PlaybackHandoff | null;
  markPositionApplied(target: PlaybackHandoffTarget): void;
}

export function handoffForSession(
  handoff: PlaybackHandoff | null,
  url: string,
  progressKey: string,
  kernel: Kernel,
): PlaybackHandoff | null {
  return handoff?.url === url && handoff.progressKey === progressKey && handoff.kernel === kernel ? handoff : null;
}

/** In-memory adapter for transferring position and pause state between playback kernels. */
export function createPlaybackHandoffPort(): PlaybackHandoffPort {
  let pending: PlaybackHandoff | null = null;

  const matchingHandoff = (target: PlaybackHandoffTarget) =>
    handoffForSession(pending, target.url, target.progressKey, target.kernel);

  return {
    stage: (handoff) => { pending = { ...handoff }; },
    readFor: (target) => {
      const handoff = matchingHandoff(target);
      return handoff ? { ...handoff } : null;
    },
    markPositionApplied: (target) => {
      const handoff = matchingHandoff(target);
      if (handoff) pending = { ...handoff, position: 0 };
    },
  };
}
