// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePlayerVolumeController } from '../src/renderer/features/playback/usePlayerVolumeController';

function Harness({ hidden = false }: { hidden?: boolean }) {
  const volume = usePlayerVolumeController();

  return (
    <div>
      <output data-testid="open">{String(volume.isOpen(hidden))}</output>
      <input
        type="range"
        ref={volume.inputRef}
        aria-label="volume"
        onFocus={() => volume.setFocused(true)}
        onBlur={() => volume.setFocused(false)}
      />
      <button onClick={volume.flash}>Flash</button>
      <button onClick={volume.beginDrag}>Start drag</button>
      <button onClick={() => volume.setHovered(true)}>Hover</button>
      <button onClick={() => volume.setHovered(false)}>Leave</button>
      <button onClick={volume.clearFlash}>Clear flash</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('usePlayerVolumeController', () => {
  it('opens for hover, focus, drag, and keyboard flash unless another panel is open', () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByTestId('open').textContent).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Hover' }));
    expect(screen.getByTestId('open').textContent).toBe('true');
    rerender(<Harness hidden />);
    expect(screen.getByTestId('open').textContent).toBe('false');
    rerender(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.focus(screen.getByRole('slider', { name: 'volume' }));
    expect(screen.getByTestId('open').textContent).toBe('true');
  });

  it('clears the keyboard flash after one second and cancels it when a panel opens', () => {
    vi.useFakeTimers();
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Flash' }));
    expect(screen.getByTestId('open').textContent).toBe('true');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('open').textContent).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Flash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear flash' }));
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByTestId('open').textContent).toBe('false');
  });

  it('ends a drag on pointerup or pointercancel and releases slider focus', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'volume' });
    act(() => slider.focus());
    fireEvent.click(screen.getByRole('button', { name: 'Start drag' }));
    expect(screen.getByTestId('open').textContent).toBe('true');

    fireEvent.pointerUp(window);
    expect(document.activeElement).not.toBe(slider);
    expect(screen.getByTestId('open').textContent).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Start drag' }));
    fireEvent.pointerCancel(window);
    expect(screen.getByTestId('open').textContent).toBe('false');
  });

  it('clears the flash timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Flash' }));
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
