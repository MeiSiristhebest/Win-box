// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayerStatusOverlays, type PlayerStatusOverlaysProps } from '../src/renderer/features/playback/PlayerStatusOverlays';

function createProps(overrides: Partial<PlayerStatusOverlaysProps> = {}): PlayerStatusOverlaysProps {
  return {
    loading: false,
    buffering: false,
    error: '',
    mpvError: '',
    paused: true,
    mini: false,
    episodePanelOpen: false,
    driveProvider: null,
    bindModalOpen: false,
    allowMpv: false,
    mpvAvailable: false,
    kernel: 'html5',
    endAll: false,
    formatBadges: [],
    onPlay: vi.fn(),
    onPlayMouseDown: vi.fn(),
    onGoToBind: vi.fn(),
    onOpenBindModal: vi.fn(),
    onDismissBindNotice: vi.fn(),
    onCloseBindModal: vi.fn(),
    onBindSaved: vi.fn(),
    onSwitchKernel: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('player pause affordance', () => {
  it('keeps the pause overlay a single accessible play action and preserves mouse/click callbacks', () => {
    const props = createProps();
    render(<PlayerStatusOverlays {...props} />);
    const playButton = screen.getByRole('button', { name: '播放' });

    fireEvent.mouseDown(playButton);
    fireEvent.click(playButton);

    expect(props.onPlayMouseDown).toHaveBeenCalledTimes(1);
    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect(playButton.className).toBe('vp-big');
  });

  it.each([
    ['playing', { paused: false }],
    ['loading', { loading: true }],
    ['mini player', { mini: true }],
    ['episode panel', { episodePanelOpen: true }],
    ['playback error', { error: 'failed' }],
  ])('hides the pause affordance while %s', (_state, overrides) => {
    render(<PlayerStatusOverlays {...createProps(overrides)} />);
    expect(screen.queryByRole('button', { name: '播放' })).toBeNull();
  });
});
