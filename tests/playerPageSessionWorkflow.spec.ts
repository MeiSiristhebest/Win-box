import { describe, expect, it, vi } from 'vitest';
import type { PlayerInitData, PlayerPagePlaybackWorkflowPort, PlayerPageWorkflowHistoryPort, PlayerSourceMemoryPort } from '../src/renderer/features/playback/application/playerPageSession';
import { createPlayerPageSessionWorkflow } from '../src/renderer/features/playback/application/playerPageSessionWorkflow';
import type { PlayerPageSessionAction } from '../src/renderer/features/playback/application/playerPageSessionState';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function playbackInit(): PlayerInitData {
  return {
    key: 'source-a',
    flag: 'line-a',
    episodes: [{ name: '第01集', url: 'episode-1' }, { name: '第02集', url: 'episode-2' }],
    epIndex: 1,
    title: '测试影片',
    lastUrl: '',
    lastName: '',
    startTime: 125,
    meta: { fromKey: 'source-a', id: 'movie-a', vodId: 'movie-a', profileId: 'profile-a', sourceName: 'Source A' },
  };
}

function alternateCandidate(): { id: string; sourceName: string; profileName: string; data: PlayerInitData } {
  return {
    id: 'profile-b\u001fsource-b\u001fmovie-b',
    sourceName: 'Source B',
    profileName: 'Profile B',
    data: {
      key: 'source-b',
      flag: 'line-b',
      episodes: [{ name: '第01集', url: 'other-episode-1' }, { name: '第02集', url: 'other-episode-2' }],
      epIndex: 1,
      title: '测试影片',
      lastUrl: '',
      lastName: '',
      startTime: 125,
      meta: { fromKey: 'source-b', id: 'movie-b', vodId: 'movie-b', profileId: 'profile-b', sourceName: 'Source B' },
    },
  };
}

describe('player page session workflow', () => {
  it('ignores hydration completion after disposal and cleans temporary playback files', async () => {
    const sourceLookup = deferred<{ profileId: string; name: string }>();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async () => ({ parse: 0, url: 'https://media.invalid/video.mp4', playUrl: '', flag: 'line-a' })),
      resolveHistorySource: vi.fn(() => sourceLookup.promise),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: (action) => actions.push(action) });
    const init: PlayerInitData = {
      key: 'source-a',
      flag: 'line-a',
      episodes: [{ name: '第01集', url: 'episode-1' }],
      epIndex: 0,
      title: '测试影片',
      lastUrl: '',
      lastName: '',
    };

    const completion = workflow.applyInit(init);
    workflow.dispose();
    sourceLookup.resolve({ profileId: 'profile-a', name: 'Source A' });
    await completion;

    expect(actions).toEqual([
      { type: 'source-fallback-cleared' },
      { type: 'hydration-started' },
    ]);
    expect(session.play).not.toHaveBeenCalled();
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(session.cleanupTemporaryFiles).toHaveBeenCalledOnce();
  });

  it('automatically uses the only verified complete alternate and records history only after playback starts', async () => {
    const candidate = alternateCandidate();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => input.key === 'source-b'
        ? { parse: 0, url: 'https://media.invalid/alternate.mp4', playUrl: '', flag: input.flag }
        : { parse: 0, url: '', playUrl: '', flag: input.flag, message: '源站没有返回媒体流' }),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [candidate], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: action => actions.push(action) });

    await workflow.applyInit(playbackInit());
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledTimes(5));
    await vi.waitFor(() => expect(actions).toContainEqual({ type: 'resolution-succeeded', url: 'https://media.invalid/alternate.mp4' }));

    expect(session.discover).toHaveBeenCalledWith(expect.objectContaining({ episodeIndex: 1, position: 125 }), expect.any(AbortSignal));
    expect(session.play).toHaveBeenNthCalledWith(5, expect.objectContaining({ key: 'source-b', id: 'other-episode-2', parseOffset: undefined }));
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(sourceMemory.rememberSource).not.toHaveBeenCalled();

    workflow.confirmPlaybackStarted();

    expect(history.recordHistory).toHaveBeenCalledOnce();
    expect(history.recordHistory).toHaveBeenCalledWith(expect.objectContaining({ url: 'other-episode-2', time: 125, profileId: 'profile-b' }));
    expect(sourceMemory.rememberSource).toHaveBeenCalledWith(expect.objectContaining({ fromKey: 'source-b', id: 'movie-b' }));
  });

  it('does not auto-switch when the aggregate search is incomplete, but lets the user choose a verified candidate', async () => {
    const candidate = alternateCandidate();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => input.key === 'source-b'
        ? { parse: 0, url: 'https://media.invalid/alternate.mp4', playUrl: '', flag: input.flag }
        : { parse: 0, url: '', playUrl: '', flag: input.flag, message: '源站没有返回媒体流' }),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [candidate], incompleteSources: 1, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: action => actions.push(action) });

    await workflow.applyInit(playbackInit());
    await vi.waitFor(() => expect(actions).toContainEqual(expect.objectContaining({ type: 'source-fallback-choices', incompleteSources: 1 })));
    expect(session.play).toHaveBeenCalledTimes(4);
    expect(history.recordHistory).not.toHaveBeenCalled();

    expect(workflow.selectAlternative(candidate.id)).toBe(true);
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledTimes(5));
    expect(history.recordHistory).not.toHaveBeenCalled();
    workflow.confirmPlaybackStarted();
    expect(history.recordHistory).toHaveBeenCalledOnce();
  });
});
