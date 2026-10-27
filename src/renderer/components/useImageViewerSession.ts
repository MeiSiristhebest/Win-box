import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { isNativeModalOpen } from '../lib/modalScope';
import {
  imageViewerOffsetAtPointer,
  imageViewerTransform,
  stepImageViewerScale,
  type ImageViewerDragOrigin,
  type ImageViewerOffset,
} from './imageViewerPolicy';

const VIEWER_CONTROL = 'button, input, select, textarea, a, [role="button"]';
const KEYBOARD_CONTROL = 'input, textarea, select, button, a, [role="button"], [contenteditable="true"]';
const IDLE_HIDE_DELAY_MS = 2500;
const WHEEL_ZOOM_STEP = 0.15;
const BUTTON_ZOOM_STEP = 0.25;

export interface ImageViewerSessionOptions {
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onRetry: () => void;
}

export function useImageViewerSession({ canPrev, canNext, onPrev, onNext, onRetry }: ImageViewerSessionOptions) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<ImageViewerOffset>({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<ImageViewerDragOrigin | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const zoomBy = useCallback((delta: number) => {
    setScale((current) => stepImageViewerScale(current, delta));
  }, []);
  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setControlsVisible(false), IDLE_HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    idleTimer.current = setTimeout(() => setControlsVisible(false), IDLE_HIDE_DELAY_MS);
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest(VIEWER_CONTROL)) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP);
      revealControls();
    };
    viewer.addEventListener('wheel', onWheel, { passive: false });
    return () => viewer.removeEventListener('wheel', onWheel);
  }, [zoomBy, revealControls]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (isNativeModalOpen() || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
        || !viewerRef.current?.getClientRects().length || target?.closest(KEYBOARD_CONTROL)) return;
      if (event.key === 'ArrowLeft' && canPrev) onPrev?.();
      else if (event.key === 'ArrowRight' && canNext) onNext?.();
      else if (event.key === '+' || event.key === '=') zoomBy(BUTTON_ZOOM_STEP);
      else if (event.key === '-') zoomBy(-BUTTON_ZOOM_STEP);
      else if (event.key === '0') resetView();
      else return;
      event.preventDefault();
      revealControls();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canPrev, canNext, onPrev, onNext, zoomBy, resetView, revealControls]);

  const onDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(VIEWER_CONTROL)) return;
    event.stopPropagation();
    resetView();
  }, [resetView]);
  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(VIEWER_CONTROL))) return;
    dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, offset };
    setDragging(true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* unsupported by test DOM */ }
  }, [offset]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    setOffset(imageViewerOffsetAtPointer(origin, event.clientX, event.clientY));
  }, []);
  const finishDrag = useCallback(() => {
    dragOrigin.current = null;
    setDragging(false);
  }, []);
  const onImageLoad = useCallback(() => setLoading(false), []);
  const onImageError = useCallback(() => {
    setLoading(false);
    setError('图片加载失败（图床可能需 Referer 或已失效）');
  }, []);

  return {
    viewerRef,
    scale,
    offset,
    imageTransform: imageViewerTransform(offset, scale),
    loading,
    error,
    controlsVisible,
    dragging,
    onMouseMove: revealControls,
    onFocusCapture: revealControls,
    onDoubleClick,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onImageLoad,
    onImageError,
    onRetry,
    zoomIn: () => zoomBy(BUTTON_ZOOM_STEP),
    zoomOut: () => zoomBy(-BUTTON_ZOOM_STEP),
    resetView,
  };
}
