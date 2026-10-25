export interface PlaybackPositionScope {
  key: string;
  profileId?: string;
}

/** Stores playback progress outside of a media engine's lifecycle. */
export interface PlaybackPositionMemoryPort {
  read(url: string, scope?: PlaybackPositionScope): number;
  save(url: string, seconds: number, scope?: PlaybackPositionScope): void;
}

/** Describes the capabilities of the runtime hosting the playback session. */
export interface PlaybackRuntimePort {
  isDesktopRuntime(): boolean;
}
