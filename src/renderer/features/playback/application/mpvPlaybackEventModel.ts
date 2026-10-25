import type { MpvKernelState } from '../../../../shared/player';
import type { PlayerPlaybackPresentationUpdate } from './PlayerPlaybackPresentation';

export type MpvPlaybackEventPlan = {
  presentation: PlayerPlaybackPresentationUpdate;
  terminalPresentation?: PlayerPlaybackPresentationUpdate;
  currentTime: number;
  resolution: { width: number; height: number };
  size: { w: number; h: number } | null;
  savePosition: number | null;
  skipAt: { time: number; duration: number } | null;
  clearAutoAdvance: boolean;
  nextEofHandled: boolean;
  advanceAfterEnd: boolean;
};

/**
 * Translate one merged engine snapshot into UI state and explicit session
 * effects. This stays pure so MPV and plugin-engine state rules can be tested
 * without React, IPC, storage, or a running player process.
 */
export function projectMpvPlaybackEvent(
  state: MpvKernelState,
  engineLabel: string,
  eofAlreadyHandled: boolean,
): MpvPlaybackEventPlan {
  const presentation: PlayerPlaybackPresentationUpdate = {
    isLive: state.live,
    duration: state.duration ?? 0,
    paused: state.paused,
    buffering: state.buffering,
  };

  if (state.loaded) presentation.loading = false;
  if (state.time != null) presentation.currentTime = state.time;
  if (state.cacheTime != null) presentation.buffered = state.cacheTime;
  if (state.cacheKbps > 0) presentation.netSpeed = state.cacheKbps;

  const terminalPresentation: PlayerPlaybackPresentationUpdate = {};
  if (state.error) {
    terminalPresentation.mpvError = `视频流无法解析（${state.error}）—可换线路或切回内置内核重试`;
    terminalPresentation.loading = false;
  }

  let nextEofHandled = eofAlreadyHandled;
  let advanceAfterEnd = false;
  if (state.eof && !state.error && !eofAlreadyHandled) {
    nextEofHandled = true;
    if (!state.playbackStarted) {
      terminalPresentation.mpvError = '视频流无法解析（分片读取失败）—— 可换线路或切回内置内核重试';
      terminalPresentation.loading = false;
    } else {
      advanceAfterEnd = true;
    }
  }

  // Keep the existing precedence: a process-exit message is the final status
  // when an engine reports exit together with another terminal condition.
  if (state.exited) {
    terminalPresentation.mpvError = `${engineLabel}进程已退出（可切回内置内核重试）`;
    terminalPresentation.loading = false;
  }

  const hasVideoSize = Boolean(state.videoW || state.videoH);
  return {
    presentation,
    terminalPresentation: Object.keys(terminalPresentation).length > 0 ? terminalPresentation : undefined,
    currentTime: state.time ?? 0,
    resolution: { width: state.videoW, height: state.videoH },
    size: hasVideoSize ? { w: state.videoW, h: state.videoH } : null,
    savePosition: state.time,
    skipAt: state.time != null && !state.error
      ? { time: state.time, duration: state.duration ?? 0 }
      : null,
    clearAutoAdvance: Boolean(state.error),
    nextEofHandled,
    advanceAfterEnd,
  };
}
