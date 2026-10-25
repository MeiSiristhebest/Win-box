/** State rendered by the player surface and controls. */
export interface PlayerPlaybackPresentation {
  paused: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  error: string;
  mpvError: string;
  loading: boolean;
  isLive: boolean;
  netSpeed: number | null;
  relaySpeed: number | null;
  buffering: boolean;
}

export type PlayerPlaybackPresentationUpdate = Partial<PlayerPlaybackPresentation>;

export const initialPlayerPlaybackPresentation: PlayerPlaybackPresentation = {
  paused: true,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  error: '',
  mpvError: '',
  loading: true,
  isLive: false,
  netSpeed: null,
  relaySpeed: null,
  buffering: false,
};

/** Apply one session event without coupling playback policy to React state. */
export function updatePlayerPlaybackPresentation(
  current: PlayerPlaybackPresentation,
  update: PlayerPlaybackPresentationUpdate,
): PlayerPlaybackPresentation {
  const changed = Object.entries(update).some(([key, value]) =>
    !Object.is(current[key as keyof PlayerPlaybackPresentation], value));
  return changed ? { ...current, ...update } : current;
}
