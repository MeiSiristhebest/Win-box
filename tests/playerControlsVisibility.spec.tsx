// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePlayerControlsVisibility } from '../src/renderer/features/playback/usePlayerControlsVisibility';

function Harness({ paused = false, panelOpen = false }: { paused?: boolean; panelOpen?: boolean }) {
  const controls = usePlayerControlsVisibility({
    isPaused: () => paused,
    panelOpen,
  });

  return (
    <div>
      <output data-testid="visible">{String(controls.visible)}</output>
      <button onClick={controls.reveal}>Reveal</button>
      <button onClick={controls.hideIfNoPanel}>Leave</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('usePlayerControlsVisibility', () => {
  it('hides controls after the idle delay while playback is active', () => {
    vi.useFakeTimers();
    render(<Harness />);

    act(() => vi.advanceTimersByTime(2799));
    expect(screen.getByTestId('visible').textContent).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('visible').textContent).toBe('false');
  });

  it('keeps controls visible while paused', () => {
    vi.useFakeTimers();
    render(<Harness paused />);

    act(() => vi.advanceTimersByTime(2800));

    expect(screen.getByTestId('visible').textContent).toBe('true');
  });

  it('shows controls for an open panel and resumes the idle timer after it closes', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Harness />);

    act(() => vi.advanceTimersByTime(2800));
    expect(screen.getByTestId('visible').textContent).toBe('false');

    rerender(<Harness panelOpen />);
    expect(screen.getByTestId('visible').textContent).toBe('true');
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByTestId('visible').textContent).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(vi.getTimerCount()).toBe(0);

    rerender(<Harness />);
    expect(screen.getByTestId('visible').textContent).toBe('true');
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(2799));
    expect(screen.getByTestId('visible').textContent).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('visible').textContent).toBe('false');
  });

  it('restarts the idle timer when controls are revealed', () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('visible').textContent).toBe('true');
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByTestId('visible').textContent).toBe('false');
  });

  it('clears the idle timer when the hook unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = render(<Harness />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
