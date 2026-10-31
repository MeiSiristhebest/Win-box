export interface PlaybackFailureEffects {
  autoChangeParse?: (currentTime: number, reason: string, cause: 'media-failure') => Promise<boolean> | boolean;
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
      autoChange = Promise.resolve(effects.autoChangeParse(currentTime, reason, 'media-failure'));
    } catch (error) {
      effects.notify(`自动切换解析线路失败：${errorMessage(error)}`);
    }
  }

  effects.onPlaybackFailure?.(currentTime, reason);

  return autoChange?.then((started) => {
    if (!started) effects.notify('没有可用的备用解析线路，请切换播放源或重新解析当前集');
  }).catch((error: unknown) => {
    effects.notify(`自动切换解析线路失败：${errorMessage(error)}`);
  }) ?? Promise.resolve();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
