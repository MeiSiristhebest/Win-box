// @vitest-environment happy-dom
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePlayerKeyboardShortcuts } from '../src/renderer/features/playback/usePlayerKeyboardShortcuts';
import { playerKeyboardShortcutsAdapter } from '../src/renderer/features/playback/adapters/playerKeyboardShortcutsAdapter';

function Harness({ isMpv = false, time = 0, duration = 60, actions }: { isMpv?: boolean; time?: number; duration?: number; actions: { play: () => void; pause: () => void; seek: (seconds: number) => void; volume: (value: number) => void; showVolume: () => void; reveal: () => void; exitFullscreen: () => void; stepSubtitleOffset?: (delta: -0.5 | 0.5) => void; toggleDanmaku?: () => void; toggleMini?: () => void; cycleFit?: () => void; toggleFullscreen?: () => void } }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  usePlayerKeyboardShortcuts({
    videoRef, isMpv: () => isMpv, isPaused: () => true, play: actions.play, pause: actions.pause,
    getTime: () => time, getDuration: () => duration, seek: actions.seek, getVolume: () => 0.5, setVolume: actions.volume,
    showVolume: actions.showVolume, revealControls: actions.reveal, exitMpvFullscreen: actions.exitFullscreen,
    onStepSubtitleOffset: actions.stepSubtitleOffset, onToggleDanmaku: actions.toggleDanmaku,
    onToggleMini: actions.toggleMini, onCycleFit: actions.cycleFit, onToggleFullscreen: actions.toggleFullscreen,
  }, playerKeyboardShortcutsAdapter);
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
    stepSubtitleOffset: vi.fn() as unknown as (delta: -0.5 | 0.5) => void,
    toggleDanmaku: vi.fn() as unknown as () => void,
    toggleMini: vi.fn() as unknown as () => void,
    cycleFit: vi.fn() as unknown as () => void,
    toggleFullscreen: vi.fn() as unknown as () => void,
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

  it('clamps keyboard seeks to the current media bounds', () => {
    const handlers = actions();
    const view = render(<Harness time={2} actions={handlers} />);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    view.rerender(<Harness time={59} actions={handlers} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(handlers.seek).toHaveBeenNthCalledWith(1, 0);
    expect(handlers.seek).toHaveBeenNthCalledWith(2, 60);
  });

  it('exits mpv fullscreen with Escape', () => {
    const handlers = actions();
    render(<Harness isMpv actions={handlers} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handlers.exitFullscreen).toHaveBeenCalledOnce();
  });

  it('adjusts subtitle offset with [ / ] and toggles danmaku with d', () => {
    const handlers = actions();
    render(<Harness actions={handlers} />);
    fireEvent.keyDown(window, { key: '[' });
    fireEvent.keyDown(window, { key: ']' });
    fireEvent.keyDown(window, { key: 'd' });

    expect(handlers.stepSubtitleOffset).toHaveBeenCalledWith(-0.5);
    expect(handlers.stepSubtitleOffset).toHaveBeenCalledWith(0.5);
    expect(handlers.toggleDanmaku).toHaveBeenCalledOnce();
    expect(handlers.reveal).toHaveBeenCalledTimes(3);
  });

  it('triggers mini pip, aspect fit cycling, and fullscreen with p, a, and f', () => {
    const handlers = actions();
    render(<Harness actions={handlers} />);
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'f' });

    expect(handlers.toggleMini).toHaveBeenCalledOnce();
    expect(handlers.cycleFit).toHaveBeenCalledOnce();
    expect(handlers.toggleFullscreen).toHaveBeenCalledOnce();
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
