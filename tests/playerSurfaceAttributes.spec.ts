import { describe, expect, it } from 'vitest';
import { applyPlayerSurfaceState } from '../src/renderer/features/playback/playerSurfaceAttributes';

describe('player surface attributes', () => {
  it('marks the transparent MPV surface and hidden player-window controls', () => {
    const root = { dataset: {} as { mpv?: string; pwinUi?: string } };

    applyPlayerSurfaceState(root, { mpvSurfaceActive: true, playerWindowControlsHidden: true });

    expect(root.dataset).toEqual({ mpv: '1', pwinUi: '0' });
  });

  it('clears markers for a visible HTML player surface', () => {
    const root = { dataset: { mpv: '1', pwinUi: '0' } };

    applyPlayerSurfaceState(root, { mpvSurfaceActive: false, playerWindowControlsHidden: false });

    expect(root.dataset).toEqual({});
  });

  it('removes markers when the player surface unmounts', () => {
    const root = { dataset: {} as { mpv?: string; pwinUi?: string } };
    const dispose = applyPlayerSurfaceState(root, { mpvSurfaceActive: true, playerWindowControlsHidden: true });

    dispose();

    expect(root.dataset).toEqual({});
  });
});
