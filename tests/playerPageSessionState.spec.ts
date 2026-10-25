import { describe, expect, it } from 'vitest';
import type { PlayerInitData } from '../src/renderer/features/playback/application/playerPageSession';
import {
  initialPlayerPageSessionState,
  presentPlayerPageSession,
  reducePlayerPageSession,
} from '../src/renderer/features/playback/application/playerPageSessionState';

function createInit(episodes: PlayerInitData['episodes'] = [{ name: '第01集', url: 'episode-1' }]): PlayerInitData {
  return {
    key: 'source-key',
    flag: '线路A',
    episodes,
    epIndex: 0,
    title: '测试影片',
    lastUrl: '',
    lastName: '',
  };
}

describe('player page session state', () => {
  it('presents resolving, ready, drive binding, and failure as exclusive states', () => {
    const started = reducePlayerPageSession(initialPlayerPageSessionState, {
      type: 'resolution-started',
      epIndex: 1,
      curName: '测试影片 - 第02集',
      playName: '测试影片',
    });

    expect(presentPlayerPageSession(started)).toMatchObject({
      epIndex: 1,
      curName: '测试影片 - 第02集',
      playName: '测试影片',
      resolving: true,
      activeUrl: '',
      driveBind: null,
      parseMsg: '',
    });

    const ready = reducePlayerPageSession(started, { type: 'resolution-succeeded', url: 'https://media.invalid/video.m3u8' });
    expect(presentPlayerPageSession(ready)).toMatchObject({
      resolving: false,
      activeUrl: 'https://media.invalid/video.m3u8',
      driveBind: null,
      parseMsg: '',
    });

    const needsBinding = reducePlayerPageSession(started, { type: 'drive-bind-required', provider: 'quark' });
    expect(presentPlayerPageSession(needsBinding)).toMatchObject({
      resolving: false,
      activeUrl: '',
      driveBind: 'quark',
      parseMsg: '',
    });

    const failed = reducePlayerPageSession(started, { type: 'resolution-failed', message: '解析失败' });
    expect(presentPlayerPageSession(failed)).toMatchObject({
      resolving: false,
      activeUrl: '',
      driveBind: null,
      parseMsg: '解析失败',
    });
  });

  it('keeps stale playback cleared when a new initialization begins and reports hydration errors', () => {
    const hydrated = reducePlayerPageSession(initialPlayerPageSessionState, {
      type: 'hydration-completed',
      init: createInit(),
      epIndex: 0,
    });
    const previous = reducePlayerPageSession(hydrated, {
      type: 'resolution-succeeded',
      url: 'https://media.invalid/old.m3u8',
    });
    const hydrating = reducePlayerPageSession(previous, { type: 'hydration-started' });
    expect(presentPlayerPageSession(hydrating)).toMatchObject({
      init: null,
      epIndex: 0,
      curName: '',
      playName: '',
      resolving: true,
      activeUrl: '',
      parseMsg: '',
    });

    const failed = reducePlayerPageSession(hydrating, { type: 'hydration-failed', message: '档案已删除' });
    expect(presentPlayerPageSession(failed)).toMatchObject({ resolving: false, activeUrl: '', parseMsg: '档案已删除' });
  });

  it('stops showing a loading state when an initialized source has no episodes', () => {
    const loading = reducePlayerPageSession(initialPlayerPageSessionState, { type: 'hydration-started' });
    const initialized = reducePlayerPageSession(loading, {
      type: 'hydration-completed',
      init: createInit([]),
      epIndex: 0,
    });

    expect(initialized.init?.episodes).toEqual([]);
    expect(presentPlayerPageSession(initialized).resolving).toBe(false);
  });

  it('does not mutate a previous snapshot and only dismisses a pending drive binding', () => {
    const start = reducePlayerPageSession(initialPlayerPageSessionState, {
      type: 'resolution-started',
      epIndex: 0,
      curName: '测试影片 - 第01集',
      playName: '测试影片',
    });
    const needsBinding = reducePlayerPageSession(start, { type: 'drive-bind-required', provider: 'uc' });
    const dismissed = reducePlayerPageSession(needsBinding, { type: 'drive-bind-dismissed' });

    expect(start.resolution).toEqual({ kind: 'resolving' });
    expect(presentPlayerPageSession(dismissed).driveBind).toBeNull();
    expect(reducePlayerPageSession(start, { type: 'drive-bind-dismissed' })).toBe(start);
  });
});
