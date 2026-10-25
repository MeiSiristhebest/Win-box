/** Minimal media contract understood by the audio session, implemented by HTMLAudioElement at the UI edge. */
export interface AudioMediaElement {
  readonly paused: boolean;
  currentTime: number;
  readonly duration: number;
  volume: number;
  load(): void;
  play(): Promise<void>;
  pause(): void;
}

/** Media I/O boundary. Keeping browser media operations behind this port makes the session replaceable in tests. */
export interface AudioPlaybackMediaPort {
  load(element: AudioMediaElement): void;
  play(element: AudioMediaElement): Promise<void>;
  pause(element: AudioMediaElement): void;
  isPaused(element: AudioMediaElement): boolean;
  currentTime(element: AudioMediaElement): number;
  duration(element: AudioMediaElement): number;
  setCurrentTime(element: AudioMediaElement, seconds: number): void;
  setVolume(element: AudioMediaElement, volume: number): void;
}

export interface AudioPlayerShortcutGuardPort {
  shouldIgnoreAudioPlaybackShortcuts(): boolean;
}

export interface AudioPlayerKeyboardShortcut {
  code: string;
  key: string;
  targetIsEditable: boolean;
  preventDefault(): void;
}

/** Global keyboard events are translated to playback intents at the renderer boundary. */
export interface AudioPlayerKeyboardEventsPort {
  subscribeKeyboardShortcuts(listener: (event: AudioPlayerKeyboardShortcut) => void): () => void;
}
