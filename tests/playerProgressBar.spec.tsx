// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PlayerProgressBar } from '../src/renderer/features/playback/PlayerProgressBar';
import type { PointerCoordinates } from '../src/renderer/features/playback/presentation/PlayerControlsViewModel';

function makeProps() {
  return {
    currentTime: 10,
    duration: 60,
    buffered: 30,
    canSeek: () => true,
    getCurrentTime: () => 10,
    seekTo: vi.fn() as unknown as (seconds: number) => void,
    formatTime: (seconds: number) => `${seconds}s`,
    onContextMenu: vi.fn() as unknown as (position: PointerCoordinates, time: number | null) => boolean,
  };
}

function setProgressBounds(element: HTMLElement) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, top: 0, right: 110, bottom: 8, width: 100, height: 8 } as DOMRect),
  });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PlayerProgressBar', () => {
  it('seeks by pointer, clamps to the duration, and clears the hover indicator', () => {
    const props = makeProps();
    const { container } = render(<PlayerProgressBar {...props} />);
    const progress = container.querySelector('.vp-progress') as HTMLDivElement;
    setProgressBounds(progress);

    fireEvent.pointerDown(progress, { button: 0, clientX: 60, pointerId: 1 });
    expect(props.seekTo).toHaveBeenCalledWith(30);
    expect(container.querySelector('.vp-htip')?.textContent).toBe('30s');

    fireEvent.pointerMove(progress, { clientX: 110, pointerId: 1 });
    expect(props.seekTo).toHaveBeenLastCalledWith(60);
    expect(container.querySelector('.vp-htip')?.textContent).toBe('60s');

    fireEvent.pointerUp(progress, { button: 0, clientX: 110, pointerId: 1 });
    fireEvent.pointerOut(progress, { relatedTarget: null });
    expect(container.querySelector('.vp-htip')).toBeNull();
  });

  it('does not seek when the track has no measurable width and bounds progress styles', () => {
    const props = makeProps();
    props.currentTime = 90;
    props.buffered = 120;
    const { container } = render(<PlayerProgressBar {...props} />);
    const progress = container.querySelector('.vp-progress') as HTMLDivElement;
    Object.defineProperty(progress, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, top: 0, right: 10, bottom: 8, width: 0, height: 8 } as DOMRect),
    });

    fireEvent.pointerDown(progress, { button: 0, clientX: 10, pointerId: 1 });

    expect(props.seekTo).not.toHaveBeenCalled();
    expect(container.querySelector('.vp-played')?.getAttribute('style')).toContain('width: 100%');
    expect(container.querySelector('.vp-buffer')?.getAttribute('style')).toContain('width: 100%');
  });

  it('uses the non-passive wheel handler for one-second seeks and reports context-menu time', () => {
    const props = makeProps();
    const { container } = render(<PlayerProgressBar {...props} />);
    const progress = container.querySelector('.vp-progress') as HTMLDivElement;
    setProgressBounds(progress);

    const wheel = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
    progress.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(props.seekTo).toHaveBeenCalledWith(11);

    fireEvent.contextMenu(progress, { clientX: 110, clientY: 20 });
    expect(props.onContextMenu).toHaveBeenCalledOnce();
    expect(props.onContextMenu).toHaveBeenLastCalledWith({ clientX: 110, clientY: 20 }, 60);
  });

  it('uses the latest presenter model after the player switches media', () => {
    const first = makeProps();
    const { container, rerender } = render(<PlayerProgressBar {...first} />);
    const progress = container.querySelector('.vp-progress') as HTMLDivElement;
    setProgressBounds(progress);
    const next = { ...makeProps(), duration: 40, seekTo: vi.fn() };

    rerender(<PlayerProgressBar {...next} />);
    fireEvent.pointerDown(progress, { button: 0, clientX: 60, pointerId: 2 });

    expect(first.seekTo).not.toHaveBeenCalled();
    expect(next.seekTo).toHaveBeenCalledWith(20);
  });
});
