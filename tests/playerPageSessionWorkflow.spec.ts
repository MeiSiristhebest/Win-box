import { describe, expect, it, vi } from 'vitest';
import type { PlayerInitData, PlayerPageHistoryPort, PlayerPageSessionPort, PlayerSourceMemoryPort } from '../src/renderer/features/playback/application/playerPageSession';
import { createPlayerPageSessionWorkflow } from '../src/renderer/features/playback/application/playerPageSessionWorkflow';
import type { PlayerPageSessionAction } from '../src/renderer/features/playback/application/playerPageSessionState';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('player page session workflow', () => {
  it('ignores hydration completion after disposal and cleans temporary playback files', async () => {
    const sourceLookup = deferred<{ profileId: string; name: string }>();
    const session: PlayerPageSessionPort = {
      play: vi.fn(async () => ({ parse: 0, url: 'https://media.invalid/video.mp4', playUrl: '', flag: 'line-a' })),
      resolveHistorySource: vi.fn(() => sourceLookup.promise),
      loadDetail: vi.fn(async () => null),
      onInit: vi.fn(() => () => undefined),
      onEpisodeSwitch: vi.fn(() => () => undefined),
      ready: vi.fn(async () => undefined),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      getPlaybackPosition: vi.fn(() => 0),
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

    expect(actions).toEqual([{ type: 'hydration-started' }]);
    expect(session.play).not.toHaveBeenCalled();
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(session.cleanupTemporaryFiles).toHaveBeenCalledOnce();
  });
});
