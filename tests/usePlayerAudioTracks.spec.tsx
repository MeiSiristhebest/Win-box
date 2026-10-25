// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { MpvAudioTrack } from '../src/shared/player';
import type { PlayerAudioTracksPort } from '../src/renderer/features/playback/application/playerAudioTracks';
import type { SessionAudioPreferencePort } from '../src/renderer/features/playback/application/sessionAudioPreference';
import { usePlayerAudioTracks } from '../src/renderer/features/playback/usePlayerAudioTracks';

function createPort() {
  let hlsSnapshot: { tracks: MpvAudioTrack[]; selectedTrackId: number | null } | null = null;
  const port: PlayerAudioTracksPort = {
    selectEngineTrack: vi.fn(),
    selectMpvTrack: vi.fn(),
    selectHlsTrack: vi.fn(),
    readHlsTracks: () => hlsSnapshot,
  };
  return {
    port,
    setHlsTracks(snapshot: { tracks: MpvAudioTrack[]; selectedTrackId: number | null } | null) {
      hlsSnapshot = snapshot;
    },
  };
}

function createPreferencePort(initial = ''): SessionAudioPreferencePort {
  let preferredTrackKey = initial;
  return {
    readPreferredTrackKey: () => preferredTrackKey,
    rememberPreferredTrackKey: key => { preferredTrackKey = key; },
  };
}

afterEach(() => {
  cleanup();
});

describe('usePlayerAudioTracks', () => {
  it('routes track selection through the injected engine command port', () => {
    const { port } = createPort();
    const preference = createPreferencePort();
    const { result } = renderHook(() => usePlayerAudioTracks('https://media.test/video', 'engine:decoder', port, preference));

    act(() => result.current.apply({ id: 7, lang: 'en', title: 'English' }));

    expect(port.selectEngineTrack).toHaveBeenCalledWith(7);
    expect(port.selectMpvTrack).not.toHaveBeenCalled();
    expect(preference.readPreferredTrackKey()).toBe('en');
  });

  it('routes MPV selection and synchronizes HLS tracks through the same port', () => {
    const { port, setHlsTracks } = createPort();
    const preference = createPreferencePort();
    const { result } = renderHook(() => usePlayerAudioTracks('https://media.test/video', 'mpv', port, preference));

    act(() => result.current.apply({ id: 3, title: 'Commentary' }));
    expect(port.selectMpvTrack).toHaveBeenCalledWith(3);

    const tracks: MpvAudioTrack[] = [{ id: 0, title: 'Japanese' }];
    setHlsTracks({ tracks, selectedTrackId: 0 });
    act(() => result.current.syncHls());
    expect(result.current.tracks).toEqual(tracks);
    expect(result.current.aid).toBe(0);
  });

  it('applies a remembered track when the current source exposes it', () => {
    const preference = createPreferencePort('English');
    const { port } = createPort();
    const { result } = renderHook(() => usePlayerAudioTracks('https://media.test/video', 'html5', port, preference));

    act(() => result.current.sync([{ id: 1, lang: 'English' }, { id: 2, lang: 'Japanese' }], 2));

    expect(port.selectHlsTrack).toHaveBeenCalledWith(1);
    expect(result.current.aid).toBe(2);
  });
});
