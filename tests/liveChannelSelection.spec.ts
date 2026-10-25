import { describe, expect, it } from 'vitest';
import type { LiveGroup } from '../src/shared/types';
import { selectLiveChannel } from '../src/renderer/features/live/application/liveChannelSelection';
import { liveSelectionMemoryKey, parseLiveSelectionMemory } from '../src/renderer/features/live/application/livePlaybackPorts';

const groups = [{
  group: '综合',
  channels: [{ name: '新闻', urls: ['https://one.test/live$主线', ' https://two.test/live$备用线 '] }],
}] as LiveGroup[];

describe('live playback selection', () => {
  it('restores a valid channel and parses the selected stream URL', () => {
    expect(selectLiveChannel(groups, '综合', '新闻', 1)).toEqual({
      groupName: '综合', channelName: '新闻', lineIdx: 1, playUrl: 'https://two.test/live',
    });
  });

  it('falls back to the first line for invalid indexes and returns no URL for missing channels', () => {
    expect(selectLiveChannel(groups, '综合', '新闻', 8)).toMatchObject({ lineIdx: 0, playUrl: 'https://one.test/live' });
    expect(selectLiveChannel(groups, '综合', 'missing', 1)).toMatchObject({ lineIdx: 0, playUrl: '' });
  });

  it('scopes remembered selection by profile, lineup URL, and lineup index', () => {
    const live = { name: 'IPTV', api: 'fallback', url: 'https://live.test/list' } as never;
    expect(liveSelectionMemoryKey('profile-a', live, 0)).not.toBe(liveSelectionMemoryKey('profile-b', live, 0));
    expect(liveSelectionMemoryKey('profile-a', live, 0)).not.toBe(liveSelectionMemoryKey('profile-a', live, 1));
  });

  it('parses only valid remembered fields and safely ignores malformed storage', () => {
    expect(parseLiveSelectionMemory('{"groupName":"综合","channelName":"新闻","lineIdx":2}')).toEqual({
      groupName: '综合', channelName: '新闻', lineIdx: 2,
    });
    expect(parseLiveSelectionMemory('{"groupName":4,"lineIdx":"2"}')).toEqual({ groupName: undefined, channelName: undefined, lineIdx: 0 });
    expect(parseLiveSelectionMemory('not-json')).toEqual({});
    expect(parseLiveSelectionMemory('["not","an","object"]')).toEqual({});
  });
});
