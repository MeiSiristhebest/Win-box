// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import DanmakuOverlay from '../src/renderer/components/DanmakuOverlay';

const canvasContext = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  measureText: vi.fn(() => ({ width: 10 })),
  strokeText: vi.fn(),
  fillText: vi.fn(),
  drawImage: vi.fn(),
};

class ResizeObserverFixture {
  static instances: ResizeObserverFixture[] = [];
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverFixture.instances.push(this);
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ResizeObserverFixture.instances = [];
  [canvasContext.setTransform, canvasContext.clearRect, canvasContext.measureText, canvasContext.strokeText, canvasContext.fillText, canvasContext.drawImage]
    .forEach((method) => method.mockClear());
});

describe('DanmakuOverlay canvas adapter', () => {
  it('disconnects resize observation, media listeners, and its animation frame on unmount', () => {
    let nextFrame = 40;
    const requestFrame = vi.fn(() => ++nextFrame);
    const cancelFrame = vi.fn();
    vi.stubGlobal('ResizeObserver', ResizeObserverFixture);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext as never);
    const removeListener = vi.spyOn(HTMLVideoElement.prototype, 'removeEventListener');
    const videoRef = createRef<HTMLVideoElement>();

    const view = render(
      <div>
        <video ref={videoRef} data-testid="video"><track kind="captions" /></video>
        <DanmakuOverlay
          videoRef={videoRef}
          items={[]}
          enabled
          region="full"
          fontSize={24}
          opacity={1}
          density={1}
          speed={110}
          offset={0}
        />
      </div>,
    );

    expect(requestFrame).toHaveBeenCalled();
    expect(ResizeObserverFixture.instances.every((observer) => observer.observe.mock.calls.length === 1)).toBe(true);
    view.unmount();

    expect(cancelFrame.mock.calls.map(([frame]) => frame)).toEqual(requestFrame.mock.results.map(({ value }) => value));
    expect(ResizeObserverFixture.instances.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('clears the backing canvas immediately when danmaku is disabled', () => {
    const requestFrame = vi.fn(() => 42);
    vi.stubGlobal('ResizeObserver', ResizeObserverFixture);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext as never);
    const videoRef = createRef<HTMLVideoElement>();

    render(
      <div>
        <video ref={videoRef}><track kind="captions" /></video>
        <DanmakuOverlay
          videoRef={videoRef}
          items={[]}
          enabled={false}
          region="full"
          fontSize={24}
          opacity={1}
          density={1}
          speed={110}
          offset={0}
        />
      </div>,
    );

    expect(canvasContext.clearRect).toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
  });
});
