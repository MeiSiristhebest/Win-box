// @vitest-environment happy-dom
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Kernel } from '../src/renderer/lib/kernel';
import { usePlayerFullscreen } from '../src/renderer/features/playback/usePlayerFullscreen';

const api = vi.hoisted(() => ({
  fullscreenCallbacks: [] as Array<(value: boolean) => void>,
  playerIsFullscreen: vi.fn(async () => ({ fullscreen: false })),
  playerSetFullscreen: vi.fn(async (fullscreen: boolean) => ({ fullscreen })),
  playerSetResizable: vi.fn(async () => undefined),
}));

vi.mock('../src/renderer/api/client', () => ({
  client: {
    playerOnFullscreen: (callback: (value: boolean) => void) => {
      api.fullscreenCallbacks.push(callback);
      return vi.fn();
    },
    playerIsFullscreen: api.playerIsFullscreen,
    playerSetFullscreen: api.playerSetFullscreen,
    playerSetResizable: api.playerSetResizable,
  },
}));

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
  const fullscreen = usePlayerFullscreen({ allowMpv, kernel, mini, containerRef, revealControls });

  return (
    <div ref={containerRef}>
      <output data-testid="fullscreen">{String(fullscreen.full)}</output>
      <button onClick={fullscreen.toggleFull}>Toggle</button>
    </div>
  );
}

beforeEach(() => {
  api.fullscreenCallbacks.length = 0;
  api.playerIsFullscreen.mockReset().mockResolvedValue({ fullscreen: false });
  api.playerSetFullscreen.mockReset().mockImplementation(async (fullscreen) => ({ fullscreen }));
  api.playerSetResizable.mockReset().mockResolvedValue(undefined);
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
    expect(api.playerSetResizable).toHaveBeenLastCalledWith(false);

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    expect(screen.getByTestId('fullscreen').textContent).toBe('false');
    expect(api.playerSetResizable).toHaveBeenLastCalledWith(true);

    unmount();
    expect(api.playerSetResizable).toHaveBeenLastCalledWith(true);
  });

  it('uses the native window fullscreen API for mpv and reveals controls afterward', async () => {
    const revealControls = vi.fn();
    render(<Harness kernel="mpv" allowMpv revealControls={revealControls} />);
    await waitFor(() => expect(api.playerIsFullscreen).toHaveBeenCalledOnce());

    act(() => api.fullscreenCallbacks[0]?.(true));
    expect(screen.getByTestId('fullscreen').textContent).toBe('true');
    expect(document.documentElement.dataset.playerFullscreen).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    await waitFor(() => expect(api.playerSetFullscreen).toHaveBeenCalledWith(true));
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
