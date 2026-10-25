import { PlayerAudioControl } from './PlayerAudioControl';
import type { PlayerControlsViewModel } from './presentation/PlayerControlsViewModel';
export type { PlayerControlsViewModel as PlayerControlsBarProps } from './presentation/PlayerControlsViewModel';
import { DanmakuPanel } from './DanmakuPanel';
import { DlnaCastControl } from './DlnaCastControl';
import { PlayerFitControl, PlayerRateControl } from './PlayerPlaybackOptions';
import { PlayerProgressBar } from './PlayerProgressBar';
import { PlayerSuperResolutionControl } from './PlayerSuperResolutionControl';
import { PlayerTechnicalBar } from './PlayerTechnicalBar';
import { PlayerTransportControls } from './PlayerTransportControls';
import { PlayerVolumeControl } from './PlayerVolumeControl';
import { SkipSegmentsControl } from './SkipSegmentsControl';
import { SubtitlePanel } from './SubtitlePanel';
import { PlayerKernelControl } from './PlayerKernelControl';

/** Stateless playback controls. The player owns state and effects; this component renders its model. */
export function PlayerControlsBar({
  mini,
  isLive,
  currentTime,
  duration,
  formatPlaybackTime,
  transport,
  technicalBar,
  progressBar,
  skipMenu,
  skipMenuRef,
  hasSkipSegments,
  skipMenuActions,
  volume,
  dlna,
  subtitle,
  danmaku,
  skipSegments,
  rate,
  kernel,
  kernelTools,
  superResolution,
  audio,
  fit,
  episodes,
  fullscreen,
}: PlayerControlsViewModel) {
  return (
    <div className={'vp-controls' + (mini ? ' vp-mini' : '')} onDoubleClick={(event) => event.stopPropagation()}>
      {mini ? (
        <div className="vp-bar">
          <PlayerTransportControls {...transport} mini />
        </div>
      ) : (
        <>
          <PlayerTechnicalBar {...technicalBar} />
          {progressBar && <PlayerProgressBar {...progressBar} />}
          {skipMenu && (
            <div
              ref={skipMenuRef}
              className="vp-skipmenu"
              style={{ left: skipMenu.x, top: skipMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <div className="vp-skipmenu-title">跳过设置 · 指针位置 {formatPlaybackTime(skipMenu.t)}</div>
              <button
                className="vp-skipmenu-item"
                disabled={skipMenu.t < 1}
                onClick={skipMenuActions.setIntro}
              >
                跳过片头至此（{formatPlaybackTime(skipMenu.t)}）
              </button>
              <button
                className="vp-skipmenu-item"
                disabled={!(duration > 0) || duration - skipMenu.t < 1}
                onClick={skipMenuActions.setOutro}
              >
                从此跳过片尾（剩 {duration > 0 ? formatPlaybackTime(Math.max(0, duration - skipMenu.t)) : '--:--'}）
              </button>
              {hasSkipSegments && (
                <button className="vp-skipmenu-item" onClick={skipMenuActions.clear}>
                  清除本集跳过点
                </button>
              )}
              <button className="vp-skipmenu-item vp-skipmenu-cancel" onClick={skipMenuActions.cancel}>取消</button>
            </div>
          )}
          <div className="vp-bar">
            <PlayerTransportControls {...transport} mini={false} />
            <span className="vp-time">
              {isLive ? <span className="vp-live">● 直播</span> : formatPlaybackTime(currentTime) + ' / ' + formatPlaybackTime(duration)}
            </span>
            <PlayerVolumeControl {...volume} />
            <DlnaCastControl {...dlna} />
            <SubtitlePanel {...subtitle} />
            <DanmakuPanel {...danmaku} />
            {skipSegments && <SkipSegmentsControl {...skipSegments} />}
            <PlayerRateControl {...rate} />
            {kernel && <PlayerKernelControl {...kernel} />}
            {kernelTools && (
              <>
                <button
                  type="button"
                  className={'vp-ctl' + (kernelTools.statsOpen ? ' vp-on' : '')}
                  title="播放统计"
                  aria-label="播放统计"
                  aria-pressed={kernelTools.statsOpen}
                  onClick={kernelTools.onToggleStats}
                >
                  <span className="vp-kernel-tag">统计</span>
                </button>
                <button
                  type="button"
                  className={'vp-ctl' + (kernelTools.keysOpen ? ' vp-on' : '')}
                  title="快捷键一览"
                  aria-label="快捷键一览"
                  aria-pressed={kernelTools.keysOpen}
                  onClick={kernelTools.onToggleKeys}
                >
                  <span className="vp-kernel-tag">键位</span>
                </button>
              </>
            )}
            <PlayerSuperResolutionControl {...superResolution} />
            <div style={{ flex: 1 }} />
            <PlayerAudioControl {...audio} />
            <PlayerFitControl {...fit} />
            {episodes && (
              <button
                type="button"
                className={'vp-ctl' + (episodes.open ? ' vp-on' : '')}
                title="选集"
                aria-label="选集"
                aria-pressed={episodes.open}
                onClick={episodes.onToggle}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
                  <path d="M9 8h7M9 12h7M9 16h5" />
                  <path d="M6.5 8h.01M6.5 12h.01M6.5 16h.01" strokeWidth="2.4" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="vp-ctl"
              title={fullscreen.active ? '退出全屏' : '全屏'}
              aria-label={fullscreen.active ? '退出全屏' : '全屏'}
              onClick={fullscreen.onToggle}
            >
              {fullscreen.active ? (
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
