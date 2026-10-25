import { useEffect, useLayoutEffect, useRef } from 'react';
import { createBossKeyPlaybackSession, type BossKeyPlaybackPort } from './application/bossKeyPlaybackSession';
import type { BossKeyPlaybackEventsPort } from './application/playerRuntimeEventsPorts';

export function useBossKeyPlaybackEvents(events: BossKeyPlaybackEventsPort, playback: BossKeyPlaybackPort): void {
  const playbackRef = useRef(playback);
  useLayoutEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    const session = createBossKeyPlaybackSession({
      hasPlaybackSurface: () => playbackRef.current.hasPlaybackSurface(),
      isPaused: () => playbackRef.current.isPaused(),
      volume: () => playbackRef.current.volume(),
      setActive: (active) => playbackRef.current.setActive(active),
      pause: () => playbackRef.current.pause(),
      play: () => playbackRef.current.play(),
      setVolume: (volume) => playbackRef.current.setVolume(volume),
      publishPaused: (paused) => playbackRef.current.publishPaused(paused),
    });
    const unsubscribeEnter = events.subscribeEnter(session.enter);
    let unsubscribeExit: (() => void) | null = null;
    try {
      unsubscribeExit = events.subscribeExit(session.exit);
    } catch (error) {
      unsubscribeEnter();
      throw error;
    }

    return () => {
      unsubscribeExit?.();
      unsubscribeEnter();
    };
  }, [events]);
}
