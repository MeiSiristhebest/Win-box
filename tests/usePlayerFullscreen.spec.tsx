// @vitest-environment happy-dom
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Kernel } from '../src/renderer/lib/kernel';
import type { PlayerFullscreenPort } from '../src/renderer/features/playback/application/playerFullscreen';
import { usePlayerFullscreen } from '../src/renderer/features/playback/usePlayerFullscreen';

const nativeFullscreen = {
  fullscreenCallbacks: [] as Array<(value: boolean) => void>,
  playerIsFullscreen: vi.fn(async () => ({ fullscreen: false })),
  playerSetFullscreen: vi.fn(async (fullscreen: boolean) => ({ fullscreen })),
  playerSetResizable: vi.fn(async () => undefined),
};
const fullscreenPort: PlayerFullscreenPort = {
  readNativeFullscreen: async () => (await nativeFullscreen.playerIsFullscreen()).fullscreen,
  setNativeFullscreen: async value => (await nativeFullscreen.playerSetFullscreen(value)).fullscreen,
  setWindowResizable: nativeFullscreen.playerSetResizable,
  subscribeToNativeFullscreen: listener => {
    nativeFullscreen.fullscreenCallbacks.push(listener);
    return vi.fn();
  },
};

function Harness({
  kernel = 'html5',
  allowMpv = false,
  mini = false,
  revealControls = () => undefined,
}: {
  kernel?: Kernel;
  allowMpv?: boolean;
  mini?: boolean;
  revealControls?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreen = usePlayerFullscreen({ allowMpv, kernel, mini, containerRef, revealControls, port: fullscreenPort });

  return (
    <div ref={containerRef}>
      <output data-testid="fullscreen">{String(fullscreen.full)}</output>
      <button onClick={fullscreen.toggleFull}>Toggle</button>
    </div>
  );
}

beforeEach(() => {
  nativeFullscreen.fullscreenCallbacks.length = 0;
  nativeFullscreen.playerIsFullscreen.mockReset().mockResolvedValue({ fullscreen: false });
  nativeFullscreen.playerSetFullscreen.mockReset().mockImplementation(async (fullscreen) => ({ fullscreen }));
  nativeFullscreen.playerSetResizable.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(document, 'exitFullscreen');
  delete document.documentElement.dataset.playerFullscreen;
  vi.restoreAllMocks();
});

describe('usePlayerFullscreen', () => {
  it('tracks HTML fullscreen changes and restores window resizing', () => {
    const { container, unmount } = render(<Harness />);
    const host = container.firstElementChild as HTMLDivElement;

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: host });
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(screen.getByTestId('fullscreen').textContent).toBe('true');
    expect(nativeFullscreen.playerSetResizable).toHaveBeenLastCalledWith(false);

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(screen.getByTestId('fullscreen').textContent).toBe('false');
    expect(nativeFullscreen.playerSetResizable).toHaveBeenLastCalledWith(true);

    unmount();
    expect(nativeFullscreen.playerSetResizable).toHaveBeenLastCalledWith(true);
  });

  it('uses the native window fullscreen API for mpv and reveals controls afterward', async () => {
    const revealControls = vi.fn();
    render(<Harness kernel="mpv" allowMpv revealControls={revealControls} />);
    await waitFor(() => expect(nativeFullscreen.playerIsFullscreen).toHaveBeenCalledOnce());

    act(() => nativeFullscreen.fullscreenCallbacks[0]?.(true));
    expect(screen.getByTestId('fullscreen').textContent).toBe('true');
    expect(document.documentElement.dataset.playerFullscreen).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    await waitFor(() => expect(nativeFullscreen.playerSetFullscreen).toHaveBeenCalledWith(true));
    expect(screen.getByTestId('fullscreen').textContent).toBe('true');
    expect(revealControls).toHaveBeenCalledOnce();
  });

  it('exits document fullscreen when switching to mini mode', async () => {
    const exitFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.createElement('div'),
    });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });

    render(<Harness mini />);

    await waitFor(() => expect(exitFullscreen).toHaveBeenCalledOnce());
  });
});
