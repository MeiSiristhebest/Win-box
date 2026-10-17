import { describe, expect, it } from 'vitest';
import { applyEpisodeSwitch } from '../src/shared/playerEpisode';

describe('player episode switch context', () => {
  const current = {
    key: 'pan-source',
    flag: 'UC线路',
    episodes: [{ name: '01', url: '{"fid":"fid-1"}' }],
    epIndex: 0,
    lastUrl: 'https://cdn.example/old-episode.m3u8',
    startTime: 123,
    meta: { vodId: 'vod-1', profileId: 'old-profile', sourceName: '旧源名' },
  };

  it('replaces the full episode list and invalidates the previous direct URL', () => {
    const episodes = [
      { name: '01', url: '{"fid":"fid-1"}' },
      { name: '02', url: '{"fid":"fid-2"}' },
    ];
    const next = applyEpisodeSwitch(current, {
      key: 'pan-source',
      vodId: 'vod-1',
      flag: 'UC线路',
      episodes,
      epIndex: 1,
    });
    expect(next).toMatchObject({ episodes, epIndex: 1, lastUrl: '', startTime: 0 });
    expect(next?.episodes[next.epIndex].url).toContain('fid-2');
  });

  it('updates the subscription profile when the detail page changed profiles', () => {
    const next = applyEpisodeSwitch(current, {
      key: 'pan-source',
      vodId: 'vod-1',
      flag: 'UC线路',
      episodes: current.episodes,
      epIndex: 0,
      profileId: 'new-profile',
      sourceName: '新源名',
    });
    expect(next?.meta).toMatchObject({ profileId: 'new-profile', sourceName: '新源名' });
  });

  it('rejects a different title instead of switching the wrong player', () => {
    const next = applyEpisodeSwitch(current, {
      key: 'pan-source',
      vodId: 'another-vod',
      flag: 'UC线路',
      episodes: current.episodes,
      epIndex: 0,
    });
    expect(next).toBeNull();
  });
});
