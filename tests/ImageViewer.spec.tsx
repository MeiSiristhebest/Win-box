// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ImageViewer from '../src/renderer/components/ImageViewer';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ImageViewer presentation', () => {
  it('retries the same image with a fresh request URL and resets failed presentation state', () => {
    const { container } = render(
      <ImageViewer url="https://images.example/poster.jpg?size=small#preview" name="Poster" />,
    );
    const firstImage = container.querySelector<HTMLImageElement>('.ivi-img');
    expect(firstImage?.getAttribute('src')).toBe('https://images.example/poster.jpg?size=small#preview');

    fireEvent.error(firstImage!);
    expect(screen.getByText(/图片加载失败/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    const retriedImage = container.querySelector<HTMLImageElement>('.ivi-img');
    expect(retriedImage?.getAttribute('src'))
      .toBe('https://images.example/poster.jpg?size=small&_r=1#preview');
    expect(screen.queryByText(/图片加载失败/)).toBeNull();
    expect(screen.getByText('图片加载中')).toBeTruthy();
  });

  it('adapts wheel zoom, pointer drag, and keyboard episode navigation', () => {
    const onNext = vi.fn();
    const { container } = render(
      <ImageViewer url="https://images.example/poster.jpg" canNext onNext={onNext} />,
    );
    const viewer = container.querySelector<HTMLDivElement>('.ivi')!;
    const image = container.querySelector<HTMLImageElement>('.ivi-img')!;
    const bounds = { width: 640, height: 360 } as DOMRect;
    const rects = [bounds] as DOMRect[] & { item: (index: number) => DOMRect | null };
    rects.item = (index) => index === 0 ? bounds : null;
    vi.spyOn(viewer, 'getClientRects').mockReturnValue(rects as DOMRectList);

    const wheel = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    fireEvent(viewer, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1.15)');

    fireEvent.pointerDown(viewer, { button: 0, clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(viewer, { clientX: 140, clientY: 65, pointerId: 1 });
    expect(image.style.transform).toBe('translate(40px, 15px) scale(1.15)');
    fireEvent.pointerUp(viewer, { pointerId: 1 });

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('releases global keyboard listeners, wheel handlers, and its idle timer on unmount', () => {
    vi.useFakeTimers();
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const { container, unmount } = render(<ImageViewer url="https://images.example/poster.jpg" />);
    const viewer = container.querySelector<HTMLDivElement>('.ivi')!;
    const removeViewerListener = vi.spyOn(viewer, 'removeEventListener');

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();

    expect(removeWindowListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeViewerListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
