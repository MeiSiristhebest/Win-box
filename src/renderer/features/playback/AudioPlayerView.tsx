import type { AudioPlayerModel } from './presentation/AudioPlayerModel';
import type { CSSProperties } from 'react';

/* oxlint-disable react/refs -- This passive view forwards the media adapter callback and event handlers to the native audio element; it never reads a ref during render. */
export function AudioPlayerView({ model }: { model: AudioPlayerModel }) {
  const { media, playback, actions } = model;
  const { url, name, cover, index, total, canPrev, canNext, onPrev, onNext, mini } = media;

  return (
    <div className={`vplayer aud${mini ? ' aud-mini' : ''}`}>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- This player has no caption source to attach. */}
      <audio
        ref={actions.attachAudioElement}
        src={url}
        aria-label={name || '音频播放器'}
        preload="auto"
        loop={playback.loop}
        onLoadedMetadata={actions.onLoadedMetadata}
        onCanPlay={actions.onCanPlay}
        onTimeUpdate={actions.onTimeUpdate}
        onPlay={actions.onPlay}
        onPause={actions.onPause}
        onWaiting={actions.onWaiting}
        onPlaying={actions.onPlaying}
        onError={actions.onError}
        onEnded={actions.onEnded}
      />
      <div className="aud-stage">
        <div className={`aud-cover${playback.paused ? '' : ' spinning'}`}>
          {cover ? <img src={cover} alt="" /> : <span className="aud-note">♪</span>}
        </div>
        <div className="aud-title" title={name}>{name || '音频'}</div>
        <div className="aud-sub">
          {index && total ? `${index} / ${total}` : ''}
          {playback.loading && !playback.error ? ' · 加载中…' : ''}
        </div>
        {playback.error && <div className="aud-err">{playback.error}</div>}
        <div className="aud-progrow">
          <span className="aud-time">{playback.currentTimeLabel}</span>
          <input
            className="aud-progress"
            type="range"
            aria-label="播放进度"
            min={0}
            max={Math.max(1, playback.duration)}
            step={5}
            value={Math.min(playback.currentTime, Math.max(1, playback.duration))}
            disabled={playback.duration <= 0}
            style={{ '--audio-progress': `${playback.progressPercent}%` } as CSSProperties}
            onChange={(event) => actions.seekTo(Number(event.currentTarget.value))}
          />
          <span className="aud-time">{playback.durationLabel}</span>
        </div>
        <div className="aud-ctls">
          <button className="vp-ctl" aria-label="上一首" disabled={!canPrev} title="上一首（←）" onClick={onPrev}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M6 5v14M19 5.5v13l-11-6.5z" fill="currentColor" /></svg>
          </button>
          <button className="aud-play" aria-label={playback.paused ? '播放' : '暂停'} title={playback.paused ? '播放（空格）' : '暂停（空格）'} onClick={actions.togglePlayback}>
            {playback.paused ? (
              <svg width="24" height="24" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor" /></svg>
            )}
          </button>
          <button className="vp-ctl" aria-label="下一首" disabled={!canNext} title="下一首（→）" onClick={onNext}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M18 5v14M5 5.5v13l11-6.5z" fill="currentColor" /></svg>
          </button>
          <button className={`vp-ctl${playback.loop ? ' on' : ''}`} aria-label={playback.loop ? '关闭单曲循环' : '开启单曲循环'} aria-pressed={playback.loop} title="单曲循环" onClick={actions.toggleLoop}>
            <svg width="17" height="17" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" fill="currentColor" /></svg>
          </button>
          <span className="aud-vol">
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 9h3l4-4v14l-4-4H4z" fill="currentColor" /></svg>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={playback.volume}
              aria-label="音量"
              onChange={(event) => actions.setVolume(Number(event.target.value))}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
/* oxlint-enable react/refs */
