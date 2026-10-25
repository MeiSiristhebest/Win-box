import { shouldSkipIntro, shouldSkipOutro, type SkipSeg } from './skipSegments';

export type MpvSegmentSkipAction =
  | { kind: 'seek-intro'; target: number }
  | { kind: 'outro-threshold-reached'; seconds: number }
  | null;

export type MpvSegmentSkipDecision = {
  introFired: boolean;
  outroFired: boolean;
  action: MpvSegmentSkipAction;
};

/** Apply the per-episode skip policy without seeking, showing UI, or advancing playback. */
export function decideMpvSegmentSkip(input: {
  live: boolean;
  time: number;
  duration: number;
  segments: SkipSeg;
  introFired: boolean;
  outroFired: boolean;
}): MpvSegmentSkipDecision {
  const unchanged = {
    introFired: input.introFired,
    outroFired: input.outroFired,
    action: null,
  } satisfies MpvSegmentSkipDecision;
  if (input.live) return unchanged;

  if (shouldSkipIntro(input.time, input.duration, input.segments, input.introFired)) {
    return {
      introFired: true,
      outroFired: input.outroFired,
      action: { kind: 'seek-intro', target: input.segments.intro },
    };
  }

  if (shouldSkipOutro(input.time, input.duration, input.segments, input.outroFired)) {
    return {
      introFired: input.introFired,
      outroFired: true,
      action: { kind: 'outro-threshold-reached', seconds: input.segments.outro },
    };
  }

  return unchanged;
}
