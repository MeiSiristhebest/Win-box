/** Minimal candidate metadata required to produce a user-facing label. */
export interface DanmakuCandidateLabelInput {
  title?: string;
  episodeTitle?: string;
  episodeNumber?: string;
}

/** Presentation capability injected into the danmaku controller. */
export type DanmakuCandidateLabelFormatter = (candidate: DanmakuCandidateLabelInput) => string;
