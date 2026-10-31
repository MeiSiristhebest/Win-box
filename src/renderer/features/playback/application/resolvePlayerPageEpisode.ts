import { formatEpisodeLabel } from '../../../lib/epName';
import { playbackResultError } from '../../../../shared/playbackResult';
import { recordOpenedPlayerEpisode } from './recordPlayerEpisode';
import { resolvePlayerPlayback } from './resolvePlayerPlayback';
import type {
  PlayerInitData,
  PlayerPageHistoryPort,
  PlayerPlaybackResolutionPort,
  PlayerSourceMemoryPort,
} from './playerPageSession';
import type { PlayerPageSessionAction } from './playerPageSessionState';

export interface ResolvePlayerPageEpisodeRequest {
  data: PlayerInitData;
  index: number;
  preparedUrl?: string;
  parseOffset?: number;
}

export interface ResolvePlayerPageEpisodePorts {
  playback: PlayerPlaybackResolutionPort;
  history: Pick<PlayerPageHistoryPort, 'recordHistory' | 'persist'>;
  sourceMemory: PlayerSourceMemoryPort;
  publish(action: PlayerPageSessionAction): void;
  isCurrent(): boolean;
}

export type ResolvePlayerPageEpisodeResult = 'resolved' | 'failed' | 'drive-bind-required' | 'stale' | 'empty';

/** Resolve one selected episode and publish only the outcome owned by this request. */
export async function resolvePlayerPageEpisode(
  request: ResolvePlayerPageEpisodeRequest,
  ports: ResolvePlayerPageEpisodePorts,
): Promise<ResolvePlayerPageEpisodeResult> {
  const { data, index, preparedUrl = '', parseOffset } = request;
  const episode = data.episodes[index];
  if (!episode) return 'empty';

  const mainTitle = (data.subtitleTitle || data.title || '').trim();
  const episodeLabel = formatEpisodeLabel(episode.name, index);
  const displayName = mainTitle ? `${mainTitle} - ${episodeLabel}` : episodeLabel;
  ports.publish({ type: 'resolution-started', epIndex: index, curName: displayName, playName: mainTitle });

  try {
    const result = await resolvePlayerPlayback(data, index, preparedUrl, ports.playback, { parseOffset });
    if (!ports.isCurrent()) return 'stale';
    if (result.needDriveCookieBind) {
      ports.publish({ type: 'drive-bind-required', provider: result.needDriveCookieBind });
      return 'drive-bind-required';
    }
    const error = playbackResultError(result);
    if (error) {
      ports.publish({ type: 'resolution-failed', message: error });
      return 'failed';
    }
    ports.publish({ type: 'resolution-succeeded', url: result.url, parseName: result.parseName });
  } catch (error) {
    if (!ports.isCurrent()) return 'stale';
    ports.publish({ type: 'resolution-failed', message: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }

  if (!data.deferHistoryUntilPlayback) {
    recordOpenedPlayerEpisode({ data, index, displayName, episodeLabel }, ports.history, ports.sourceMemory);
  }
  return 'resolved';
}
