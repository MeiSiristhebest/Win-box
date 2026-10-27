// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useImageViewerSession } from '../src/renderer/components/useImageViewerSession';

function Harness({ onPrev = vi.fn(), onNext = vi.fn(), onRetry = vi.fn() }: {
  onPrev?: () => void;
  onNext?: () => void;
  onRetry?: () => void;
}) {
  const { viewerRef, imageTransform, scale, controlsVisible, loading, error, onMouseMove, onDoubleClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onImageLoad, onImageError, zoomIn, onRetry: retry } = useImageViewerSession({ canPrev: true, canNext: true, onPrev, onNext, onRetry });
  return (
    <div
      ref={viewerRef}
      data-testid="surface"
      style={{ transform: imageTransform }}
      onMouseMove={onMouseMove}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <output data-testid="zoom">{scale}</output>
      <output data-testid="visible">{String(controlsVisible)}</output>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="error">{error}</output>
      <img alt="preview" onLoad={onImageLoad} onError={onImageError} />
      <button onClick={zoomIn}>Zoom in</button>
      <button onClick={retry}>Retry</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useImageViewerSession', () => {
  it('owns zoom, drag, reset, and image navigation actions', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Harness onPrev={onPrev} onNext={onNext} />);
    const surface = screen.getByTestId('surface');
    Object.defineProperty(surface, 'getClientRects', { value: () => [{ width: 500, height: 300 }] });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByTestId('zoom').textContent).toBe('1.25');
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 35, clientY: 5 });
    expect(surface.getAttribute('style')).toContain('translate(25px, -15px)');
    fireEvent.pointerCancel(surface);
    fireEvent.doubleClick(surface);
    expect(surface.getAttribute('style')).toContain('translate(0px, 0px) scale(1)');

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('does not steal keyboard events from focused controls and owns image failure and retry state', () => {
    const onNext = vi.fn();
    const onRetry = vi.fn();
    render(<Harness onNext={onNext} onRetry={onRetry} />);
    const surface = screen.getByTestId('surface');
    Object.defineProperty(surface, 'getClientRects', { value: () => [{ width: 500, height: 300 }] });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Zoom in' }), { key: 'ArrowRight' });
    fireEvent.error(screen.getByRole('img', { name: 'preview' }));
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toContain('图片加载失败');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onNext).not.toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not navigate behind an open native modal and resumes after it closes', () => {
    const onNext = vi.fn();
    render(<Harness onNext={onNext} />);
    const surface = screen.getByTestId('surface');
    Object.defineProperty(surface, 'getClientRects', { value: () => [{ width: 500, height: 300 }] });
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).not.toHaveBeenCalled();

    dialog.remove();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('hides idle controls and clears its timer when the viewer unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = render(<Harness />);
    expect(screen.getByTestId('visible').textContent).toBe('true');

    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getByTestId('visible').textContent).toBe('false');

    fireEvent.mouseMove(screen.getByTestId('surface'));
    expect(screen.getByTestId('visible').textContent).toBe('true');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes global key and local wheel listeners when the viewer unmounts', () => {
    const onNext = vi.fn();
    const addListener = vi.spyOn(Element.prototype, 'addEventListener');
    const removeListener = vi.spyOn(Element.prototype, 'removeEventListener');
    const view = render(<Harness onNext={onNext} />);
    const surface = screen.getByTestId('surface');
    Object.defineProperty(surface, 'getClientRects', { value: () => [{ width: 500, height: 300 }] });

    expect(addListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    view.unmount();
    expect(removeListener).toHaveBeenCalledWith('wheel', expect.any(Function));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).not.toHaveBeenCalled();
  });
});
