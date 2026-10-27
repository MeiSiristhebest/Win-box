// src/renderer/components/ImageViewer.tsx
// ★ 2026-09-30（用户要求「图片需要独立的图片播放器正确展示」）：
//   图集类源（摄影作品/套图/妹子…）把**每一张图**当作一「集」放进 vod_play_url，
//   此前这些地址进了 `<video>` ⇒ 黑屏。这里用图片浏览器接管：
//   · 自适应（contain）显示 + 滚轮/按钮缩放（0.25×~5×）+ 拖拽平移 + 双击复位；
//   · 上一张/下一张（联动外层剧集回调，键盘 ←/→ 同步）；
//   · 页码指示、加载中/失败提示（失败可重试）；
//   · 鼠标静止 2.5s 淡出工具条（鼠标一动即回）。
import { useState } from 'react';
import { imageViewerRetryUrl } from './imageViewerPolicy';
import { useImageViewerSession } from './useImageViewerSession';

export interface ImageViewerProps {
  url: string;
  /** 资源名（剧名-集名），显示在左上角 */
  name?: string;
  /** 当前第几张 / 共几张（外层传入；1 基） */
  index?: number;
  total?: number;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  /** 小窗口模式：只留最简工具条 */
  mini?: boolean;
}

export default function ImageViewer(props: ImageViewerProps) {
  const [reload, setReload] = useState(0);
  const src = imageViewerRetryUrl(props.url, reload);
  return (
    <ImageViewerContent
      key={src}
      {...props}
      src={src}
      onRetry={() => setReload((value) => value + 1)}
    />
  );
}

type ImageViewerContentProps = Omit<ImageViewerProps, 'url'> & { src: string; onRetry: () => void };

function ImageViewerContent({ src, name, index, total, canPrev, canNext, onPrev, onNext, mini = false, onRetry }: ImageViewerContentProps) {
  const { viewerRef, imageTransform, scale, loading, error, controlsVisible, dragging, onMouseMove, onFocusCapture, onDoubleClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onImageLoad, onImageError, onRetry: retry, zoomIn, zoomOut, resetView } = useImageViewerSession({ canPrev, canNext, onPrev, onNext, onRetry });

  return (
    <div
      ref={viewerRef}
      className="vplayer ivi"
      onMouseMove={onMouseMove}
      onFocusCapture={onFocusCapture}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
    >
      {!error && (
        <img
          className="ivi-img"
          src={src}
          alt={name || ''}
          draggable={false}
          style={{ transform: imageTransform }}
          onLoad={onImageLoad}
          onError={onImageError}
        />
      )}
      {loading && !error && (
        <div className="vp-loading">
          <span className="vp-spin" />
          <span className="vp-load-text">图片加载中</span>
        </div>
      )}
      {error && (
        <div className="vp-err" onDoubleClick={(e) => e.stopPropagation()}>
          <div>{error}</div>
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <button className="primary" onClick={retry}>重试</button>
          </div>
        </div>
      )}
      <div className={`ivi-bar${controlsVisible && !mini ? '' : ' ivi-hide'}`}>
        <span className="ivi-title" title={name}>{name || '图片'}</span>
        <span className="ivi-page">{index && total ? `${index} / ${total}` : ''}</span>
        <span className="ivi-zoom">{Math.round(scale * 100)}%</span>
        <button className="vp-ctl" aria-label="缩小" title="缩小" onClick={zoomOut}>−</button>
        <button className="vp-ctl" aria-label="放大" title="放大" onClick={zoomIn}>+</button>
        <button className="vp-ctl" aria-label="复位缩放和位置" title="复位（双击画面同效）" onClick={resetView}>
          <svg width="15" height="15" viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z" fill="currentColor" /></svg>
        </button>
        <button className="vp-ctl vp-nav" aria-label="上一张" title="上一张" disabled={!canPrev} onClick={onPrev}>
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M15 5.5v13l-11-6.5z" fill="currentColor" /></svg>
        </button>
        <button className="vp-ctl vp-nav" aria-label="下一张" title="下一张" disabled={!canNext} onClick={onNext}>
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 5.5v13l11-6.5z" fill="currentColor" /></svg>
        </button>
      </div>
      {!mini && (
        <div className={`ivi-nav ivi-left${controlsVisible ? '' : ' ivi-hide'}`}>
          <button className="ivi-nav-btn" aria-label="上一张" disabled={!canPrev} title="上一张（←）" onClick={onPrev}>
            <svg width="26" height="26" viewBox="0 0 24 24"><path d="M15 5.5v13l-11-6.5z" fill="currentColor" /></svg>
          </button>
        </div>
      )}
      {!mini && (
        <div className={`ivi-nav ivi-right${controlsVisible ? '' : ' ivi-hide'}`}>
          <button className="ivi-nav-btn" aria-label="下一张" disabled={!canNext} title="下一张（→）" onClick={onNext}>
            <svg width="26" height="26" viewBox="0 0 24 24"><path d="M9 5.5v13l11-6.5z" fill="currentColor" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
