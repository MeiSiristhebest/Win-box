export type UnsubscribePlayerEvent = () => void;

export interface RelaySpeedEventsPort {
  subscribe(onSpeed: (kilobytesPerSecond: number) => void): UnsubscribePlayerEvent;
}

export interface BossKeyPlaybackEventsPort {
  subscribeEnter(onEnter: () => void): UnsubscribePlayerEvent;
  subscribeExit(onExit: () => void): UnsubscribePlayerEvent;
}
