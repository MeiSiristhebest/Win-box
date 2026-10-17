// @vitest-environment happy-dom
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePlayerKeyboardShortcuts } from '../src/renderer/features/playback/usePlayerKeyboardShortcuts';

function Harness({ isMpv = false, actions }: { isMpv?: boolean; actions: { play: () => void; pause: () => void; seek: (seconds: number) => void; volume: (value: number) => void; showVolume: () => void; reveal: () => void; exitFullscreen: () => void } }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  usePlayerKeyboardShortcuts({
    videoRef, isMpv: () => isMpv, isPaused: () => true, play: actions.play, pause: actions.pause,
    getTime: () => 0, getDuration: () => 60, seek: actions.seek, getVolume: () => 0.5, setVolume: actions.volume,
    showVolume: actions.showVolume, revealControls: actions.reveal, exitMpvFullscreen: actions.exitFullscreen,
  });
  return <><video ref={videoRef} /><input aria-label='text entry' /></>
}

function actions() {
  return {
    play: vi.fn() as unknown as () => void,
    pause: vi.fn() as unknown as () => void,
    seek: vi.fn() as unknown as (seconds: number) => void,
    volume: vi.fn() as unknown as (value: number) => void,
    showVolume: vi.fn() as unknown as () => void,
    reveal: vi.fn() as unknown as () => void,
    exitFullscreen: vi.fn() as unknown as () => void,
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('usePlayerKeyboardShortcuts', () => {
  it('handles playback, seek, and volume keys and ignores text inputs', () => {
    const handlers = actions();
    render(<Harness actions={handlers} />);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: ' ' });

    expect(handlers.play).toHaveBeenCalledOnce();
    expect(handlers.seek).toHaveBeenCalledWith(5);
    expect(handlers.volume).toHaveBeenCalledWith(0.55);
    expect(handlers.showVolume).toHaveBeenCalledOnce();
    expect(handlers.reveal).toHaveBeenCalledOnce();
  });

  it('exits mpv fullscreen with Escape', () => {
    const handlers = actions();
    render(<Harness isMpv actions={handlers} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handlers.exitFullscreen).toHaveBeenCalledOnce();
  });

  it('does not route global playback shortcuts while a native dialog is open', () => {
    const handlers = actions();
    render(<Harness actions={handlers} />);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);

    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });

    expect(handlers.play).not.toHaveBeenCalled();
    expect(handlers.pause).not.toHaveBeenCalled();
    expect(handlers.seek).not.toHaveBeenCalled();
    expect(handlers.volume).not.toHaveBeenCalled();
    expect(handlers.showVolume).not.toHaveBeenCalled();
    expect(handlers.reveal).not.toHaveBeenCalled();
    expect(handlers.exitFullscreen).not.toHaveBeenCalled();

    dialog.remove();
    fireEvent.keyDown(window, { key: ' ' });
    expect(handlers.play).toHaveBeenCalledOnce();
  });
});
