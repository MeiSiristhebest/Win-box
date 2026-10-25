type CanvasSurface = Pick<HTMLCanvasElement, 'width' | 'height' | 'clientWidth' | 'clientHeight'>;
type CanvasContext = Pick<CanvasRenderingContext2D, 'setTransform' | 'clearRect'>;

/** Clear the whole backing store regardless of the previous frame's transform. */
export function clearDanmakuCanvas(ctx: CanvasContext, canvas: Pick<CanvasSurface, 'width' | 'height'>): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/** Restore CSS-pixel drawing coordinates on every frame, including after toggling. */
export function prepareDanmakuCanvas(ctx: CanvasContext, canvas: CanvasSurface, dpr: number): void {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const width = Math.round(canvas.clientWidth * scale);
  const height = Math.round(canvas.clientHeight * scale);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  clearDanmakuCanvas(ctx, canvas);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}
