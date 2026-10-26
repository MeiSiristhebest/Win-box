export interface PlaybackFailureEffects {
  autoChangeParse?: (currentTime: number) => Promise<boolean> | boolean;
  onPlaybackFailure?: (currentTime: number, reason: string) => void;
  notify: (message: string) => void;
}

/** Coordinates playback recovery callbacks without depending on React or a player engine. */
export function reportPlaybackFailure(
  currentTime: number,
  reason: string,
  effects: PlaybackFailureEffects,
): Promise<void> {
  let autoChange: Promise<boolean> | undefined;

  if (effects.autoChangeParse) {
    effects.notify(`流异常（${reason}），正在自动为您切换解析线路…`);
    try {
      autoChange = Promise.resolve(effects.autoChangeParse(currentTime));
    } catch (error) {
      effects.notify(`自动切换解析线路失败：${errorMessage(error)}`);
    }
  }

  effects.onPlaybackFailure?.(currentTime, reason);

  return autoChange?.then(() => undefined).catch((error: unknown) => {
    effects.notify(`自动切换解析线路失败：${errorMessage(error)}`);
  }) ?? Promise.resolve();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
