import type {
  EpgChannelRef,
  LiveBean,
  LiveEpgResult,
  LiveGroup,
  UserConfig,
} from '../../../../shared/types';

export interface LiveLineup {
  groups: LiveGroup[];
  liveName: string;
}

export interface LiveSelectionMemory {
  groupName?: string;
  channelName?: string;
  lineIdx?: number;
}

export interface LivePlaybackDataPort {
  readConfiguration(): Promise<UserConfig>;
  loadLineup(index: number): Promise<LiveLineup>;
  setActiveLineup(index: number): Promise<void>;
  loadProgramGuide(index: number, channels: EpgChannelRef[]): Promise<LiveEpgResult>;
}

export interface LiveSelectionMemoryPort {
  read(key: string): LiveSelectionMemory;
  write(key: string, value: LiveSelectionMemory): void;
}

export interface LivePlaybackRefreshPort {
  onSourcesChanged(listener: () => void): () => void;
  onWindowFocus(listener: () => void): () => void;
}

export interface LivePlaybackClockPort {
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export function liveSelectionMemoryKey(profileId: string, live: LiveBean | undefined, index: number): string {
  return 'winbox-live-mem:' + JSON.stringify([profileId, live?.url || live?.api || '', index]);
}

export function parseLiveSelectionMemory(raw: string | null | undefined): LiveSelectionMemory {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const memory = value as Record<string, unknown>;
    return {
      groupName: typeof memory.groupName === 'string' ? memory.groupName : undefined,
      channelName: typeof memory.channelName === 'string' ? memory.channelName : undefined,
      lineIdx: Number.isSafeInteger(memory.lineIdx) && Number(memory.lineIdx) >= 0 ? Number(memory.lineIdx) : 0,
    };
  } catch {
    return {};
  }
}
