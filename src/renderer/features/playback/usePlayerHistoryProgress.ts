import { useEffect, useRef } from 'react';
import {
  persistPlayerProgress,
  type PlayerHistoryProgressPort,
  type PlayerHistoryProgressSnapshot,
} from './application/playerHistoryProgress';

/** Owns only the periodic and final history checkpoint for the current playback session. */
export function usePlayerHistoryProgress(
  snapshot: PlayerHistoryProgressSnapshot | null,
  port: PlayerHistoryProgressPort,
): void {
  const latest = useRef(snapshot);
  const canTrack = Boolean(snapshot?.rawUrl && snapshot.playbackUrl);

  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!canTrack) return;
    const timer = setInterval(() => persistPlayerProgress(latest.current, port), 5000);
    return () => clearInterval(timer);
  }, [canTrack, port]);

  useEffect(() => () => persistPlayerProgress(latest.current, port), [port]);
}
