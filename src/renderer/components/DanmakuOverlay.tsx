import { useDanmakuCanvasRenderer, type DanmakuOverlayProps } from './useDanmakuCanvasRenderer';

export type { DanmakuOverlayProps } from './useDanmakuCanvasRenderer';

/** Thin React surface; the canvas renderer adapter owns DOM and animation lifecycles. */
export default function DanmakuOverlay(props: DanmakuOverlayProps) {
  const canvasRef = useDanmakuCanvasRenderer(props);
  return (
    <canvas
      ref={canvasRef}
      className="vp-danmaku"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}
    />
  );
}