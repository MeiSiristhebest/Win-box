import { makeStaleGuard } from '../../../lib/staleGuard';
import { hydratePlayerInit } from './hydratePlayerInit';
import type {
  PlayerInitData,
  PlayerPageHistoryPort,
  PlayerPageSessionPort,
  PlayerSourceMemoryPort,
} from './playerPageSession';
import { resolvePlayerPageEpisode } from './resolvePlayerPageEpisode';
import type { PlayerPageResolutionState, PlayerPageSessionAction } from './playerPageSessionState';

export interface PlayerPageSessionWorkflowPorts {
  session: PlayerPageSessionPort;
  history: PlayerPageHistoryPort;
  sourceMemory: PlayerSourceMemoryPort;
  publish(action: PlayerPageSessionAction): void;
}

export interface PlayerPageSessionWorkflow {
  applyInit(incoming: PlayerInitData): Promise<void>;
  selectEpisode(index: number): void;
  retryCurrent(resolutionKind: PlayerPageResolutionState['kind']): void;
  autoChangeParse(currentPosition?: number): Promise<boolean>;
  dismissDriveBinding(): void;
  onDriveBound(resolutionKind: PlayerPageResolutionState['kind']): void;
  begin(): void;
  dispose(): void;
}

/** Owns the standalone player page's hydration, episode, retry, and teardown workflow. */
export function createPlayerPageSessionWorkflow(
  ports: PlayerPageSessionWorkflowPorts,
): PlayerPageSessionWorkflow {
  const { session, history, sourceMemory, publish } = ports;
  const generation = makeStaleGuard();
  let currentInit: PlayerInitData | null = null;
  let pendingInit: PlayerInitData | null = null;
  let currentEpisodeIndex = 0;
  let parseOffset = 0;

  const updateInit = (next: PlayerInitData) => {
    currentInit = next;
    publish({ type: 'init-updated', init: next });
  };

  const resolve = async (data: PlayerInitData, index: number, preparedUrl = '', options?: { parseOffset?: number }) => {
    if (!data.episodes || index < 0 || index >= data.episodes.length) return;
    const requestGeneration = generation.next();
    await resolvePlayerPageEpisode(
      { data, index, preparedUrl, parseOffset: options?.parseOffset },
      {
        playback: session,
        history,
        sourceMemory,
        publish,
        isCurrent: () => generation.isCurrent(requestGeneration),
      },
    );
  };

  const applyInit = async (incoming: PlayerInitData) => {
    const requestGeneration = generation.next();
    pendingInit = incoming;
    currentInit = null;
    publish({ type: 'hydration-started' });

    let hydrated: PlayerInitData | null;
    try {
      hydrated = await hydratePlayerInit(incoming, session, () => generation.isCurrent(requestGeneration));
    } catch (error) {
      if (!generation.isCurrent(requestGeneration)) return;
      publish({ type: 'hydration-failed', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (!hydrated || !generation.isCurrent(requestGeneration)) return;
    pendingInit = null;
    updateInit(hydrated);
    const episodeIndex = Math.max(0, Math.min(hydrated.epIndex || 0, (hydrated.episodes?.length || 1) - 1));
    currentEpisodeIndex = episodeIndex;
    publish({ type: 'hydration-completed', init: hydrated, epIndex: episodeIndex });
    if (hydrated.episodes.length === 0) return;
    void resolve(hydrated, episodeIndex, hydrated.lastUrl);
  };

  const selectEpisode = (index: number) => {
    parseOffset = 0;
    const current = currentInit;
    if (!current || !Number.isInteger(index) || index < 0 || index >= current.episodes.length) return;
    currentEpisodeIndex = index;
    const next = { ...current, startTime: 0, lastUrl: '', epIndex: index };
    updateInit(next);
    void resolve(next, index);
  };

  const retryCurrent = (resolutionKind: PlayerPageResolutionState['kind']) => {
    if (resolutionKind === 'hydrating' || resolutionKind === 'resolving') return;
    const pending = pendingInit;
    if (pending) {
      parseOffset = 0;
      void applyInit(pending);
      return;
    }
    const current = currentInit;
    if (current) void resolve(current, currentEpisodeIndex, '', { parseOffset });
  };

  const autoChangeParse = async (currentPosition?: number): Promise<boolean> => {
    const current = currentInit;
    if (!current) return false;
    parseOffset += 1;
    const next = currentPosition != null && currentPosition > 0
      ? { ...current, startTime: currentPosition }
      : current;
    updateInit(next);
    await resolve(next, currentEpisodeIndex, '', { parseOffset });
    return true;
  };

  return {
    applyInit,
    selectEpisode,
    retryCurrent,
    autoChangeParse,
    dismissDriveBinding: () => publish({ type: 'drive-bind-dismissed' }),
    onDriveBound: (resolutionKind) => {
      publish({ type: 'drive-bind-dismissed' });
      retryCurrent(resolutionKind);
    },
    begin: () => history.beginPlayerHistorySession(),
    dispose: () => {
      generation.next();
      pendingInit = null;
      currentInit = null;
      void session.cleanupTemporaryFiles().catch(() => undefined);
    },
  };
}
