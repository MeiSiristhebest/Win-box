import { describe, expect, it, vi } from 'vitest';
import type { PlayResult } from '../src/shared/types';
import type { PlayerInitData, PlayerPageHistoryPort, PlayerPlaybackResolutionPort, PlayerSourceMemoryPort } from '../src/renderer/features/playback/application/playerPageSession';
import type { PlayerPageSessionAction } from '../src/renderer/features/playback/application/playerPageSessionState';
import { resolvePlayerPageEpisode } from '../src/renderer/features/playback/application/resolvePlayerPageEpisode';

function successfulPlay(url: string): PlayResult {
  return { parse: 0, url, playUrl: '', flag: 'line-a' };
}

function createFixture(play: PlayerPlaybackResolutionPort['play']) {
  const data: PlayerInitData = {
    key: 'source-a',
    flag: 'line-a',
    episodes: [{ name: 'Episode 1', url: 'episode-1' }],
    epIndex: 0,
    title: 'Example show',
    lastUrl: '',
    lastName: '',
    meta: { fromKey: 'source-a', sourceName: 'Source A', profileId: 'profile-a', vodId: 'vod-1' },
  };
  const actions: PlayerPageSessionAction[] = [];
  const history: Pick<PlayerPageHistoryPort, 'recordHistory' | 'persist'> = {
    recordHistory: vi.fn(),
    persist: vi.fn(),
  };
  const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
  const ports = {
    playback: { play } satisfies PlayerPlaybackResolutionPort,
    history,
    sourceMemory,
    publish: (action: PlayerPageSessionAction) => actions.push(action),
    isCurrent: () => true,
  };
  return { data, actions, history, sourceMemory, ports };
}

describe('resolvePlayerPageEpisode', () => {
  it('publishes a successful playable URL before recording the opened episode', async () => {
    const fixture = createFixture(vi.fn(async () => successfulPlay('https://media.invalid/episode.mp4')));

    await resolvePlayerPageEpisode({ data: fixture.data, index: 0 }, fixture.ports);

    expect(fixture.actions.map((action) => action.type)).toEqual(['resolution-started', 'resolution-succeeded']);
    expect(fixture.actions[1]).toMatchObject({ type: 'resolution-succeeded', url: 'https://media.invalid/episode.mp4' });
    expect(fixture.sourceMemory.rememberSource).toHaveBeenCalledOnce();
    expect(fixture.history.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
      url: 'episode-1',
      sourceKey: 'source-a',
      profileId: 'profile-a',
    }));
    expect(fixture.history.persist).toHaveBeenCalledOnce();
  });

  it('does not publish or record an outdated resolution', async () => {
    let finish!: (result: PlayResult) => void;
    const fixture = createFixture(vi.fn(() => new Promise<PlayResult>((resolve) => { finish = resolve; })));
    let current = true;
    fixture.ports.isCurrent = () => current;

    const pending = resolvePlayerPageEpisode({ data: fixture.data, index: 0 }, fixture.ports);
    current = false;
    finish(successfulPlay('https://media.invalid/old.mp4'));
    await pending;

    expect(fixture.actions.map((action) => action.type)).toEqual(['resolution-started']);
    expect(fixture.sourceMemory.rememberSource).not.toHaveBeenCalled();
    expect(fixture.history.recordHistory).not.toHaveBeenCalled();
  });

  it('maps thrown resolver errors into failed state without recording history', async () => {
    const fixture = createFixture(vi.fn(async () => { throw new Error('resolver offline'); }));

    await resolvePlayerPageEpisode({ data: fixture.data, index: 0 }, fixture.ports);

    expect(fixture.actions.at(-1)).toEqual({ type: 'resolution-failed', message: 'resolver offline' });
    expect(fixture.sourceMemory.rememberSource).not.toHaveBeenCalled();
    expect(fixture.history.recordHistory).not.toHaveBeenCalled();
  });

  it('rejects a resolver result without a playable URL and skips history', async () => {
    const fixture = createFixture(vi.fn(async () => successfulPlay('')));

    await resolvePlayerPageEpisode({ data: fixture.data, index: 0 }, fixture.ports);

    expect(fixture.actions.at(-1)).toMatchObject({ type: 'resolution-failed' });
    expect(fixture.sourceMemory.rememberSource).not.toHaveBeenCalled();
    expect(fixture.history.recordHistory).not.toHaveBeenCalled();
  });

  it('ignores an out-of-range episode before issuing a playback request', async () => {
    const play = vi.fn(async () => successfulPlay('https://media.invalid/episode.mp4'));
    const fixture = createFixture(play);

    await resolvePlayerPageEpisode({ data: fixture.data, index: 1 }, fixture.ports);

    expect(play).not.toHaveBeenCalled();
    expect(fixture.actions).toEqual([]);
  });
});
