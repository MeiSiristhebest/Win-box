export const IMAGE_VIEWER_MIN_SCALE = 0.25;
export const IMAGE_VIEWER_MAX_SCALE = 5;

export interface ImageViewerOffset {
  x: number;
  y: number;
}

export interface ImageViewerDragOrigin {
  pointerX: number;
  pointerY: number;
  offset: ImageViewerOffset;
}

export function clampImageViewerScale(value: number): number {
  const finiteValue = Number.isFinite(value) ? value : 1;
  return Math.min(IMAGE_VIEWER_MAX_SCALE, Math.max(IMAGE_VIEWER_MIN_SCALE, Number(finiteValue.toFixed(2))));
}

export function stepImageViewerScale(current: number, delta: number): number {
  return clampImageViewerScale(current + delta);
}

export function imageViewerOffsetAtPointer(
  origin: ImageViewerDragOrigin,
  pointerX: number,
  pointerY: number,
): ImageViewerOffset {
  return {
    x: origin.offset.x + pointerX - origin.pointerX,
    y: origin.offset.y + pointerY - origin.pointerY,
  };
}

export function imageViewerTransform(offset: ImageViewerOffset, scale: number): string {
  return `translate(${offset.x}px, ${offset.y}px) scale(${clampImageViewerScale(scale)})`;
}

export function imageViewerRetryUrl(url: string, retry: number): string {
  if (retry <= 0) return url;
  const hashStart = url.indexOf('#');
  const resourceUrl = hashStart < 0 ? url : url.slice(0, hashStart);
  const hash = hashStart < 0 ? '' : url.slice(hashStart);
  const separator = resourceUrl.includes('?') ? '&' : '?';
  return `${resourceUrl}${separator}_r=${encodeURIComponent(String(retry))}${hash}`;
}
