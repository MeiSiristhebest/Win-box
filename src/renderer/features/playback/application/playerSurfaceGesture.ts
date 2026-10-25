export interface PlayerSurfaceGesturePorts {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(timer: unknown): void;
  togglePlayback(): void;
}

export interface PlayerSurfaceClick {
  mini: boolean;
  ignored: boolean;
}

/** Owns the single-click versus double-click playback decision without UI dependencies. */
export function createPlayerSurfaceGesture(ports: PlayerSurfaceGesturePorts) {
  let pendingTimer: unknown;
  let hasPendingTimer = false;
  let generation = 0;

  const cancelPending = () => {
    generation += 1;
    if (!hasPendingTimer) return;
    ports.cancel(pendingTimer);
    pendingTimer = undefined;
    hasPendingTimer = false;
  };

  return {
    click({ mini, ignored }: PlayerSurfaceClick): void {
      if (ignored) return;
      if (mini) {
        ports.togglePlayback();
        return;
      }
      if (hasPendingTimer) {
        cancelPending();
        return;
      }

      const clickGeneration = ++generation;
      hasPendingTimer = true;
      pendingTimer = ports.schedule(() => {
        if (clickGeneration !== generation) return;
        pendingTimer = undefined;
        hasPendingTimer = false;
        ports.togglePlayback();
      }, 280);
    },
    dispose: cancelPending,
  };
}
