// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LiveGroup, UserConfig } from '../src/shared/types';
import type {
  LivePlaybackClockPort,
  LivePlaybackDataPort,
  LivePlaybackRefreshPort,
  LiveSelectionMemoryPort,
} from '../src/renderer/features/live/application/livePlaybackPorts';
import { liveSelectionMemoryKey } from '../src/renderer/features/live/application/livePlaybackPorts';
import { useLivePlayback } from '../src/renderer/features/live/useLivePlayback';

const profile = {
  activeProfileId: 'profile-a',
  ui: { activeLiveIndex: 0 },
  lives: [{ name: 'IPTV', api: '', url: 'https://live.test/list' }],
} as unknown as UserConfig;

const groups: LiveGroup[] = [{
  group: '综合',
  channels: [
    { name: '新闻', urls: ['https://one.test/live$主线', 'https://two.test/live$备用线'], 'tvg-id': '', 'tvg-name': '', epg: '' },
    { name: '电影', urls: ['https://movie.test/live'], 'tvg-id': '', 'tvg-name': '', epg: '' },
  ] as never,
}];

describe('useLivePlayback', () => {
  it('restores remembered channel/line, persists user selections, and uses injected runtime ports', async () => {
    const data: LivePlaybackDataPort = {
      readConfiguration: vi.fn().mockResolvedValue(profile),
      loadLineup: vi.fn().mockResolvedValue({ groups, liveName: 'IPTV' }),
      setActiveLineup: vi.fn().mockResolvedValue(undefined),
      loadProgramGuide: vi.fn().mockResolvedValue({ byKey: {} }),
    };
    const memory: LiveSelectionMemoryPort = {
      read: vi.fn().mockReturnValue({ groupName: '综合', channelName: '新闻', lineIdx: 1 }),
      write: vi.fn(),
    };
    const refresh: LivePlaybackRefreshPort = {
      onSourcesChanged: vi.fn().mockReturnValue(vi.fn()),
      onWindowFocus: vi.fn().mockReturnValue(vi.fn()),
    };
    const clock: LivePlaybackClockPort = {
      now: () => 0,
      schedule: vi.fn().mockReturnValue('timer'),
      cancel: vi.fn(),
    };
    const { result } = renderHook(() => useLivePlayback({ data, memory, refresh, clock }));

    await waitFor(() => expect(result.current.playUrl).toBe('https://two.test/live'));
    expect(result.current.curGroup?.group).toBe('综合');
    expect(result.current.curChannel?.name).toBe('新闻');
    expect(result.current.lineIdx).toBe(1);
    expect(data.loadProgramGuide).toHaveBeenCalledOnce();
    expect(memory.read).toHaveBeenCalledWith(liveSelectionMemoryKey('profile-a', profile.lives[0], 0));
    expect(memory.write).toHaveBeenCalledWith(
      liveSelectionMemoryKey('profile-a', profile.lives[0], 0),
      { groupName: '综合', channelName: '新闻', lineIdx: 1 },
    );

    act(() => result.current.pickChannel(groups[0]!, '电影', 0));
    await waitFor(() => expect(result.current.playUrl).toBe('https://movie.test/live'));
    expect(result.current.channelName).toBe('电影');
    expect(memory.write).toHaveBeenLastCalledWith(
      liveSelectionMemoryKey('profile-a', profile.lives[0], 0),
      { groupName: '综合', channelName: '电影', lineIdx: 0 },
    );
  });

  it('supports automatic line failover and catchup timeshift switching', async () => {
    const data: LivePlaybackDataPort = {
      readConfiguration: vi.fn().mockResolvedValue(profile),
      loadLineup: vi.fn().mockResolvedValue({ groups, liveName: 'IPTV' }),
      setActiveLineup: vi.fn().mockResolvedValue(undefined),
      loadProgramGuide: vi.fn().mockResolvedValue({ byKey: {} }),
    };
    const memory: LiveSelectionMemoryPort = {
      read: vi.fn().mockReturnValue({ groupName: '综合', channelName: '新闻', lineIdx: 0 }),
      write: vi.fn(),
    };
    const refresh: LivePlaybackRefreshPort = {
      onSourcesChanged: vi.fn().mockReturnValue(vi.fn()),
      onWindowFocus: vi.fn().mockReturnValue(vi.fn()),
    };
    const clock: LivePlaybackClockPort = {
      now: () => 0,
      schedule: vi.fn().mockReturnValue('timer'),
      cancel: vi.fn(),
    };
    const { result } = renderHook(() => useLivePlayback({ data, memory, refresh, clock }));

    await waitFor(() => expect(result.current.playUrl).toBe('https://one.test/live'));
    expect(result.current.lineIdx).toBe(0);

    // Failover from line 0 to line 1
    act(() => {
      const switched = result.current.failoverToNextLine('网络超时');
      expect(switched).toBe(true);
    });
    await waitFor(() => expect(result.current.playUrl).toBe('https://two.test/live'));
    expect(result.current.lineIdx).toBe(1);
    expect(result.current.liveToast).toContain('已自动为您切至线路 2');

    // Timeshift catchup playback
    act(() => {
      result.current.playCatchup({
        title: '早间新闻',
        start: '07:00',
        end: '08:00',
        startTime: 1700000000000,
        endTime: 1700003600000,
      });
    });
    expect(result.current.isCatchupActive).toBe(true);
    expect(result.current.playUrl).toContain('playseek=');

    // Return to live
    act(() => {
      result.current.exitCatchup();
    });
    expect(result.current.isCatchupActive).toBe(false);
    expect(result.current.playUrl).toBe('https://two.test/live');
  });
});
