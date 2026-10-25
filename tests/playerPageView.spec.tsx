// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerPageSession } from '../src/renderer/features/playback/usePlayerPageSession';
import type { PlayerPageWindowState } from '../src/renderer/features/playback/usePlayerPageWindow';
import { PlayerPageView } from '../src/renderer/pages/PlayerPageView';

describe('PlayerPageView', () => {
  it('offers a retry action when initial hydration fails before an init is available', () => {
    const retryCurrent = vi.fn();
    const session: PlayerPageSession = {
      init: null,
      epIndex: 0,
      activeUrl: '',
      curName: '',
      playName: '',
      resolving: false,
      driveBind: null,
      parseMsg: '档案读取失败',
      episodes: [],
      canPrev: false,
      canNext: false,
      selectEpisode: vi.fn(),
      retryCurrent,
      autoChangeParse: vi.fn(),
      dismissDriveBinding: vi.fn(),
      onDriveBound: vi.fn(),
    };
    const windowState: PlayerPageWindowState = {
      appIcon: '',
      maximized: false,
      mini: false,
      pinTop: false,
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      setMini: vi.fn(),
      togglePinTop: vi.fn(),
      close: vi.fn(),
    };

    render(<PlayerPageView session={session} windowState={windowState} title="Win-Box" onResolutionChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retryCurrent).toHaveBeenCalledOnce();
  });
});
