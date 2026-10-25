import { describe, expect, it, vi } from 'vitest';
import { createPlayerSurfaceGesture } from '../src/renderer/features/playback/application/playerSurfaceGesture';

function makeGesture() {
  let callback: (() => void) | undefined;
  let delay = 0;
  const togglePlayback = vi.fn();
  const cancel = vi.fn();
  const gesture = createPlayerSurfaceGesture({
    schedule: vi.fn((next, milliseconds) => {
      callback = next;
      delay = milliseconds;
      return 'timer';
    }),
    cancel,
    togglePlayback,
  });
  return { gesture, callback: () => callback?.(), delay: () => delay, togglePlayback, cancel };
}

describe('player surface gesture', () => {
  it('delays a desktop single click until the double-click window expires', () => {
    const test = makeGesture();
    test.gesture.click({ mini: false, ignored: false });
    expect(test.delay()).toBe(280);
    expect(test.togglePlayback).not.toHaveBeenCalled();
    test.callback();
    expect(test.togglePlayback).toHaveBeenCalledOnce();
  });

  it('cancels the pending single-click action on a second click', () => {
    const test = makeGesture();
    test.gesture.click({ mini: false, ignored: false });
    test.gesture.click({ mini: false, ignored: false });
    test.callback();
    expect(test.cancel).toHaveBeenCalledWith('timer');
    expect(test.togglePlayback).not.toHaveBeenCalled();
  });

  it('toggles immediately in mini mode and ignores consumed clicks', () => {
    const test = makeGesture();
    test.gesture.click({ mini: true, ignored: false });
    test.gesture.click({ mini: false, ignored: true });
    expect(test.togglePlayback).toHaveBeenCalledOnce();
  });

  it('cancels a pending click when the controller is disposed', () => {
    const test = makeGesture();
    test.gesture.click({ mini: false, ignored: false });
    test.gesture.dispose();
    test.callback();
    expect(test.cancel).toHaveBeenCalledWith('timer');
    expect(test.togglePlayback).not.toHaveBeenCalled();
  });
});
