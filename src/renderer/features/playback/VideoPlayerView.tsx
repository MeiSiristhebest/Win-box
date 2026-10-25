import type { CSSProperties } from 'react';
import { formatPlaybackTime } from './formatting';
import { PlayerEpisodePanel } from './PlayerEpisodePanel';
import { PlayerContextMenu } from './PlayerContextMenu';
import { PlayerInfoOverlay } from './PlayerInfoOverlay';
import ImageViewer from '../../components/ImageViewer';
import AudioPlayer from '../../components/AudioPlayer';
import DanmakuOverlay from '../../components/DanmakuOverlay';
import { PlayerTechnicalPanels } from './PlayerTechnicalPanels';
import { PlayerStatusOverlays } from './PlayerStatusOverlays';
import { PlayerControlsBar } from './PlayerControlsBar';
import type { VideoPlayerPresenterModel } from './VideoPlayerPresenter';

export function VideoPlayerView({ model }: { model: VideoPlayerPresenterModel }) {
  const { identity, media, navigation, surface, playback, danmaku, contextMenu, episodes, technicalPanels, info, toast, status, controls } = model;
  const { url, resourceName, mini } = identity;
  const { canPrev, canNext, onPrev, onNext } = navigation;
  const { videoRef: ref, containerRef: wrapRef, controlsVisible: ui, full, fit, subFont, subBottom, onPointerActivity: poke, onPointerLeave: hideIfNoPanel, onDoubleClick: onSurfaceDoubleClick, onTogglePlayback: onSurfaceClick, onBoostMouseDown } = surface;
  const { kernel, mpvTimeRef, mpvSizeRef, paused, currentTime: cur, duration: dur, resolution: resText } = playback;
  const { items: dmItems, enabled: dmEnabled, settings: dmCfg } = danmaku;
  const { position, menuRef, infoOpen, actions: contextActions } = contextMenu;
  const playerContextMenu = { position, menuRef, onContextMenu: surface.onContextMenu };
  const { items: episodeItems, current: episodeIndex, open: epPanel, title: episodeTitle, page: episodePage, onPageChange: setEpisodePage, onClose: closeEpisodes, onSelect: pickEpisode } = episodes;
  const { audioTracks, subtitles, pluginKeys, active, statsOpen, keysOpen, mini: panelMini, mpvTech, formatNetworkSpeed, onStatsClose, onKeysClose } = technicalPanels;
  const { skip: skipToast, boost: boostTip, commandError } = toast;
  const statusProps = status;
  const playerControlsModel = controls;
  /**
   * ★ 2026-09-30：图片 / 音频分流（所有 hooks 都在上方，早返回不破坏 hooks 顺序）。
   *   图集源把每张图当一「集」传进来 → 图片浏览器按「集」翻页；
   *   音乐源同理 → 音乐播放器按「曲」切歌。
   */
  if (media.kind === 'image') {
    return (
      <ImageViewer
        url={url}
        name={resourceName}
        index={media.episodeNumber}
        total={media.episodeCount}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={onPrev}
        onNext={onNext}
        mini={mini}
      />
    );
  }
  if (media.kind === 'audio') {
    return (
      <AudioPlayer
        url={url}
        playbackSource={media.playbackSource}
        name={resourceName}
        cover={media.cover}
        index={media.episodeNumber}
        total={media.episodeCount}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={onPrev}
        onNext={onNext}
        startTime={media.startTime}
        mini={mini}
      />
    );
  }

  /**
   * ★ 2026-10-08（用户要求「把置顶按钮从播放器下方取消，做到上方最小化按钮旁边，播放器下方的功能区太拥挤了」）：
   *   置顶按钮已挪到**播放器窗口标题栏**（`TitleBar` 的 showPin；小窗口模式在 mini 条上），
   *   本组件不再渲染置顶入口（见 PlayerPage 的 pinTop 状态与 TitleBar 接线）。
   */

  return (
    <div
      ref={wrapRef}
      className={`vplayer${ui ? ' vui' : ''}${full ? ' vfull' : ''}${mini ? ' vp-mini' : ''}`}
      style={{ '--sub-font': `${subFont}px`, '--sub-bottom': `${subBottom}px` } as CSSProperties}
      onMouseMove={poke}
            onMouseLeave={hideIfNoPanel}
      onDoubleClick={onSurfaceDoubleClick}
      onContextMenu={playerContextMenu.onContextMenu}
    >
      {/* ★ 2026-09-26：画面比例（用户要求）—— video 包进 stage/ratio 两层：
          · `.vp-stage` 绝对定位、撑满 `.vplayer` 且 `overflow:hidden` → **画面永不越出播放器区域**；
          · `.vp-ratio` 承载「强制 16:9 / 4:3」的定比盒子（其余模式为 100%×100%）；
          · 具体缩放交由 `object-fit`（contain/fill/cover/none），不改变元素盒尺寸。
          这同时修掉「某些比例的视频把底部控制条挤出可视区」的老问题（flex min-height 链见 global.css）。 */}
      <div
        className={`vp-stage fit-${fit}`}
      >
        <div className="vp-ratio">
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Downloaded subtitles are attached with video.addTextTrack. */}
          <video ref={ref} style={{ width: '100%', height: '100%' }} playsInline />
        </div>
        <button
          type="button"
          className="vp-stage-toggle"
          aria-label={paused ? '播放' : '暂停'}
          aria-pressed={!paused}
          onClick={onSurfaceClick}
          onMouseDown={onBoostMouseDown}
        />
      </div>
      {/* 弹幕叠加层（canvas，全屏区域，不拦截鼠标；fit 决定绘制区是否避让宽银幕黑边）
          ★ 2026-10-08 MPV 内核：时间/画面尺寸由主进程事件驱动（mpv 子窗口在 Chromium 之下，覆盖层仍在其上） */}
      <DanmakuOverlay
        videoRef={ref}
        mpv={kernel === 'mpv' ? { time: mpvTimeRef, size: mpvSizeRef } : null}
        items={dmItems}
        enabled={dmEnabled}
        fit={fit}
        region={dmCfg.region}
        fontSize={dmCfg.fontSize}
        opacity={dmCfg.opacity}
        density={dmCfg.density}
        speed={dmCfg.speed}
        offset={dmCfg.offset}
      />
      {/* ★ 2026-10-08（用户要求）：跳过片头片尾的短暂提示（2.5s 淡出；不拦截鼠标） */}
      <PlayerContextMenu position={playerContextMenu.position} menuRef={playerContextMenu.menuRef} onInfo={contextActions.onInfo} onCopy={contextActions.onCopy} />
      {!mini && episodeItems?.length ? <PlayerEpisodePanel episodes={episodeItems} current={episodeIndex} open={epPanel} title={episodeTitle} page={episodePage} onPageChange={setEpisodePage} onClose={closeEpisodes} onSelect={pickEpisode} /> : null}
      <PlayerTechnicalPanels audioTracks={audioTracks} subtitles={subtitles} pluginKeys={pluginKeys} active={active} statsOpen={statsOpen} keysOpen={keysOpen} mini={panelMini} mpvTech={mpvTech} fmtNet={formatNetworkSpeed} onStatsClose={onStatsClose} onKeysClose={onKeysClose} />
      <PlayerInfoOverlay open={infoOpen && !mini} title={info.title} currentTime={cur} duration={dur} resolution={resText} formatTime={formatPlaybackTime} />
      {(skipToast || boostTip > 0 || commandError) && (
        <div className={`vp-toast${commandError ? ' vp-command-error' : ''}`} role={commandError ? 'status' : undefined}>
          {commandError || skipToast || boostTip + 'x'}
        </div>
      )}
      <PlayerStatusOverlays {...statusProps} />
      {/* 控制条（小窗口：只保留 上/下集 + 播放暂停） */}
            <PlayerControlsBar {...playerControlsModel} />
    </div>
  );
}
