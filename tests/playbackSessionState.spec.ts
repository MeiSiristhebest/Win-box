import { describe, expect, it } from 'vitest';
import { createPlaybackSessionStatePort } from '../src/renderer/features/playback/application/playbackSessionState';

describe('playback session state port', () => {
  it('keeps live playback state behind semantic accessors', () => {
    const port = createPlaybackSessionStatePort(() => ({ intro: 0, outro: 0 }));

    expect(port.getLivePlaybackKind()).toBe(false);
    port.setLivePlaybackKind(true);
    expect(port.getLivePlaybackKind()).toBe(true);
  });

  it('reads the latest skip segments when a session asks for them', () => {
    let segments = { intro: 0, outro: 0 };
    const port = createPlaybackSessionStatePort(() => segments);

    expect(port.getSkipSegments()).toEqual({ intro: 0, outro: 0 });
    segments = { intro: 18, outro: 42 };
    expect(port.getSkipSegments()).toEqual({ intro: 18, outro: 42 });
  });

  it('returns a snapshot so session code cannot mutate the controller state', () => {
    const segments = { intro: 18, outro: 42 };
    const port = createPlaybackSessionStatePort(() => segments);
    const snapshot = port.getSkipSegments();

    snapshot.intro = 90;
    expect(port.getSkipSegments()).toEqual({ intro: 18, outro: 42 });
  });
});
