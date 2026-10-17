// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAutoNextEpisode } from '../src/renderer/features/playback/useAutoNextEpisode';

function Harness({
  canNext = true,
  onNext = () => undefined,
  onPrev = () => undefined,
  paused = false,
  onPause = () => undefined,
}: {
  canNext?: boolean;
  onNext?: () => void;
  onPrev?: () => void;
  paused?: boolean;
  onPause?: () => void;
}) {
  const episode = useAutoNextEpisode({
    canNext,
    onNext,
    onPrev,
    isPaused: () => paused,
    pause: onPause,
  });

  return (
    <div>
      <output data-testid="count">{episode.nextCount ?? ''}</output>
      <output data-testid="finished">{String(episode.endAll)}</output>
      <button onClick={episode.handlePlaybackEnd}>Ended</button>
      <button onClick={episode.cancelCountdown}>Cancel</button>
      <button onClick={episode.handlePrev}>Previous</button>
      <button onClick={episode.handleNext}>Next</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAutoNextEpisode', () => {
  it('counts down from five seconds and advances once', () => {
    vi.useFakeTimers();
    const onNext = vi.fn();
    render(<Harness onNext={onNext} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ended' }));
    expect(screen.getByTestId('count').textContent).toBe('5');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('count').textContent).toBe('4');
    act(() => vi.advanceTimersByTime(4000));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('count').textContent).toBe('');
  });

  it('shows completion when there is no next episode', () => {
    vi.useFakeTimers();
    render(<Harness canNext={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ended' }));

    expect(screen.getByTestId('finished').textContent).toBe('true');
    expect(screen.getByTestId('count').textContent).toBe('');
  });

  it('clears the active timer when the hook unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Ended' }));
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the countdown and pauses only when playback is active', () => {
    vi.useFakeTimers();
    const onNext = vi.fn();
    const onPause = vi.fn();
    const { rerender } = render(<Harness onNext={onNext} onPause={onPause} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ended' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('count').textContent).toBe('');
    act(() => vi.advanceTimersByTime(5000));
    expect(onNext).not.toHaveBeenCalled();

    rerender(<Harness onNext={onNext} onPause={onPause} paused />);
    fireEvent.click(screen.getByRole('button', { name: 'Ended' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('uses the latest next callback and clears timers on manual navigation', () => {
    vi.useFakeTimers();
    const oldNext = vi.fn();
    const newNext = vi.fn();
    const onPrev = vi.fn();
    const { rerender } = render(<Harness onNext={oldNext} onPrev={onPrev} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ended' }));
    rerender(<Harness onNext={newNext} onPrev={onPrev} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('count').textContent).toBe('4');

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('count').textContent).toBe('');
    act(() => vi.advanceTimersByTime(5000));
    expect(oldNext).not.toHaveBeenCalled();
    expect(newNext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ended' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(newNext).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(newNext).toHaveBeenCalledTimes(1);
  });
});
