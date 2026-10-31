import { describe, expect, it } from 'vitest';
import { matchPlaybackEpisode, samePlaybackTitle } from '../src/renderer/features/playback/application/playbackSourceMatching';

describe('playback source identity matching', () => {
  it('accepts punctuation and release metadata while retaining year and season identity', () => {
    expect(samePlaybackTitle('《繁花》 (2023) 4K', '繁花 2023')).toBe(true);
    expect(samePlaybackTitle('流浪地球', '流浪地球2')).toBe(false);
    expect(samePlaybackTitle('庆余年 第二季', '庆余年 第2季')).toBe(true);
    expect(samePlaybackTitle('庆余年 第二季', '庆余年 第一季')).toBe(false);
    expect(samePlaybackTitle('繁花 2023', '繁花 2024')).toBe(false);
  });

  it('matches an explicit episode number across Chinese and S01E01 labels', () => {
    expect(matchPlaybackEpisode('第十二集', {
      '高清': [{ name: 'S01E12.1080p.mkv', url: 'episode-12' }],
    })).toEqual({
      kind: 'unique',
      match: { flag: '高清', index: 0, episode: { name: 'S01E12.1080p.mkv', url: 'episode-12' } },
    });
  });

  it('does not treat the same list index as proof of the same episode', () => {
    expect(matchPlaybackEpisode('第03集', {
      '高清': [
        { name: '第01集', url: 'episode-1' },
        { name: '第02集', url: 'episode-2' },
        { name: '番外篇', url: 'special' },
      ],
    })).toEqual({ kind: 'none' });
  });

  it('rejects duplicate episode matches across play flags as ambiguous', () => {
    expect(matchPlaybackEpisode('第01集', {
      '国语': [{ name: '第01集', url: 'episode-1-zh' }],
      '粤语': [{ name: '第01集', url: 'episode-1-yue' }],
    })).toEqual({ kind: 'ambiguous', count: 2 });
  });

  it('uses an exact label only when the selected episode has no explicit ordinal', () => {
    expect(matchPlaybackEpisode('预告片', {
      '正片': [{ name: '预告片', url: 'trailer' }],
    })).toMatchObject({ kind: 'unique', match: { flag: '正片', index: 0 } });
    expect(matchPlaybackEpisode('未知集名', {
      '正片': [{ name: '不同集名', url: 'episode' }],
    })).toEqual({ kind: 'none' });
  });
});
