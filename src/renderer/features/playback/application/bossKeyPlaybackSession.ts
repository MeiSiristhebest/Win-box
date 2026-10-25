export interface BossKeyPlaybackPort {
  hasPlaybackSurface(): boolean;
  isPaused(): boolean;
  volume(): number;
  setActive(active: boolean): void;
  pause(): void;
  play(): void;
  setVolume(volume: number): void;
  publishPaused(paused: boolean): void;
}

type PlaybackSnapshot = { wasPlaying: boolean; volume: number };

/** Owns the pause/mute snapshot policy while the application is hidden by the boss key. */
export function createBossKeyPlaybackSession(port: BossKeyPlaybackPort) {
  let snapshot: PlaybackSnapshot | null = null;

  return {
    enter(): void {
      if (!port.hasPlaybackSurface() || snapshot) return;

      port.setActive(true);
      snapshot = { wasPlaying: !port.isPaused(), volume: port.volume() };
      port.pause();
      port.setVolume(0);
      port.publishPaused(true);
    },

    exit(): void {
      const previous = snapshot;
      snapshot = null;
      port.setActive(false);
      if (!previous) return;

      port.setVolume(previous.volume);
      if (!previous.wasPlaying) return;
      port.play();
      port.publishPaused(false);
    },
  };
}
