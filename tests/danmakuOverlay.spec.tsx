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
  vi.useRealTimers();
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

  it('clears the full backing canvas before every active animation frame', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      callbacks.set(id, callback);
      return id;
    });
    const cancelFrame = vi.fn((id: number) => callbacks.delete(id));
    vi.stubGlobal('ResizeObserver', ResizeObserverFixture);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext as never);
    const videoRef = createRef<HTMLVideoElement>();

    const view = render(
      <div>
        <video ref={videoRef}><track kind="captions" /></video>
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
    const canvas = view.container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 100 });

    const clearCallsBeforeActiveFrames = canvasContext.clearRect.mock.calls.length;
    const advancePendingFrame = (timestamp: number) => {
      const pending = callbacks.entries().next().value;
      expect(pending, 'renderer should have one pending animation frame').toBeDefined();
      if (!pending) return;
      callbacks.delete(pending[0]);
      pending[1](timestamp);
    };
    advancePendingFrame(16);
    advancePendingFrame(32);

    expect(canvasContext.clearRect.mock.calls.slice(clearCallsBeforeActiveFrames)).toEqual([
      [0, 0, 200, 100],
      [0, 0, 200, 100],
    ]);
    const pendingFrameId = callbacks.keys().next().value;
    view.unmount();
    expect(pendingFrameId).toBeDefined();
    expect(cancelFrame).toHaveBeenCalledWith(pendingFrameId);
  });

  it('clears mpv size polling when the overlay unmounts', () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', ResizeObserverFixture);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext as never);
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');
    const videoRef = createRef<HTMLVideoElement>();

    const view = render(
      <div>
        <DanmakuOverlay
          videoRef={videoRef}
          mpv={{ time: { current: 0 }, size: { current: { w: 1920, h: 1080 } } }}
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

    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(clearInterval).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the MPV size observer and polling stable when its wrapper object is recreated', () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', ResizeObserverFixture);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext as never);
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const time = { current: 0 };
    const size = { current: { w: 1920, h: 1080 } };
    const videoRef = createRef<HTMLVideoElement>();
    const renderOverlay = () => (
      <div>
        <DanmakuOverlay
          videoRef={videoRef}
          mpv={{ time, size }}
          items={[]}
          enabled={false}
          region="full"
          fontSize={24}
          opacity={1}
          density={1}
          speed={110}
          offset={0}
        />
      </div>
    );
    const view = render(renderOverlay());

    expect(ResizeObserverFixture.instances).toHaveLength(1);
    expect(setInterval).toHaveBeenCalledOnce();
    view.rerender(renderOverlay());

    expect(ResizeObserverFixture.instances).toHaveLength(1);
    expect(setInterval).toHaveBeenCalledOnce();
    view.unmount();
  });
});
