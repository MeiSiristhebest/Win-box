import type { PlayResult } from '../../../../shared/types';
import type { DetailSelectionMemory } from './detailDataPorts';

export interface DetailEpisodePlaybackRequest {
  key: string;
  flag: string;
  episodeUrl: string;
  profileId: string;
}

/** Only the playback and remembered-selection capabilities used by the detail workflow. */
export interface DetailPlaybackPort {
  play(request: DetailEpisodePlaybackRequest): Promise<PlayResult>;
  rememberSelection(key: string, selection: DetailSelectionMemory): void;
  persistSelection(): void;
}

export type DetailEpisodePlaybackOutcome =
  | { kind: 'ready'; url: string }
  | { kind: 'needs-drive-binding'; provider: string }
  | { kind: 'failed'; message: string };
