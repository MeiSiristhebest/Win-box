import { describe, expect, it } from 'vitest';
import { createBossKeyPlaybackSession, type BossKeyPlaybackPort } from '../src/renderer/features/playback/application/bossKeyPlaybackSession';

function createHarness(initiallyPaused = false) {
  const calls: string[] = [];
  let currentVolume = 0.72;
  let paused = initiallyPaused;
  const port: BossKeyPlaybackPort = {
    hasPlaybackSurface: () => true,
    isPaused: () => paused,
    volume: () => currentVolume,
    setActive: (active) => calls.push(`active:${active}`),
    pause: () => { calls.push('pause'); paused = true; },
    play: () => { calls.push('play'); paused = false; },
    setVolume: (volume) => { calls.push(`volume:${volume}`); currentVolume = volume; },
    publishPaused: (value) => calls.push(`paused:${value}`),
  };
  return { calls, port, session: createBossKeyPlaybackSession(port) };
}

describe('boss-key playback session', () => {
  it('pauses and mutes, then restores the prior playing state and volume', () => {
    const { calls, session } = createHarness();

    session.enter();
    session.exit();

    expect(calls).toEqual([
      'active:true', 'pause', 'volume:0', 'paused:true',
      'active:false', 'volume:0.72', 'play', 'paused:false',
    ]);
  });

  it('restores volume without resuming playback that was already paused', () => {
    const { calls, session } = createHarness(true);

    session.enter();
    session.exit();

    expect(calls).toEqual([
      'active:true', 'pause', 'volume:0', 'paused:true',
      'active:false', 'volume:0.72',
    ]);
  });

  it('does not overwrite the saved state when the enter notification repeats', () => {
    const { calls, session } = createHarness();

    session.enter();
    session.enter();
    session.exit();

    expect(calls.filter((call) => call === 'pause')).toHaveLength(1);
    expect(calls).toContain('volume:0.72');
    expect(calls).toContain('play');
  });

  it('does not pause a window without a playback surface', () => {
    const { calls, session, port } = createHarness();
    port.hasPlaybackSurface = () => false;

    session.enter();

    expect(calls).toEqual([]);
  });

  it('clears the active marker even when exit arrives without a matching enter', () => {
    const { calls, session } = createHarness();

    session.exit();

    expect(calls).toEqual(['active:false']);
  });
});
