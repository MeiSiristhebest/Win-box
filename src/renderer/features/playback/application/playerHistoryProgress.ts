export interface PlayerProgressHistoryRecord {
  url: string;
  rawUrl?: string;
  name?: string;
  flag?: string;
  pic?: string;
  remarks?: string;
  sourceName?: string;
  sourceKey?: string;
  profileId?: string;
  vodId?: string;
  time?: number;
}

export interface PlayerHistoryProgressSnapshot {
  rawUrl: string;
  playbackUrl: string;
  name: string;
  flag?: string;
  sourceName?: string;
  sourceKey: string;
  profileId?: string;
  vodId?: string;
  pic?: string;
  episodeName?: string;
}

export interface PlayerHistoryProgressPort {
  getPlaybackPosition(url: string, source: { profileId?: string; key: string }): number;
  recordHistory(entry: PlayerProgressHistoryRecord): void;
  persist(): void;
}

/** Convert the active player state into the history record written by the renderer adapter. */
export function toPlayerProgressRecord(
  snapshot: PlayerHistoryProgressSnapshot,
  time: number,
): PlayerProgressHistoryRecord {
  return {
    url: snapshot.rawUrl,
    rawUrl: snapshot.rawUrl,
    flag: snapshot.flag,
    sourceName: snapshot.sourceName,
    sourceKey: snapshot.sourceKey,
    profileId: snapshot.profileId,
    vodId: snapshot.vodId,
    pic: snapshot.pic,
    name: snapshot.name,
    remarks: snapshot.episodeName,
    time,
  };
}

export function persistPlayerProgress(
  snapshot: PlayerHistoryProgressSnapshot | null,
  port: PlayerHistoryProgressPort,
): void {
  if (!snapshot?.rawUrl || !snapshot.playbackUrl) return;
  const time = port.getPlaybackPosition(snapshot.playbackUrl, {
    profileId: snapshot.profileId,
    key: snapshot.sourceKey,
  });
  if (time <= 0) return;
  port.recordHistory(toPlayerProgressRecord(snapshot, time));
  port.persist();
}
