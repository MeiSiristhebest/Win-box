import { describe, expect, it, vi } from 'vitest';
import { reportPlaybackFailure } from '../src/renderer/features/playback/application/reportPlaybackFailure';

describe('reportPlaybackFailure', () => {
  it('starts parse failover and notifies the owning playback page synchronously', async () => {
    const order: string[] = [];
    const autoChangeParse = vi.fn(() => {
      order.push('auto-change');
      return Promise.resolve(true);
    });
    const onPlaybackFailure = vi.fn(() => order.push('page-failure'));
    const notify = vi.fn((message: string) => order.push(message));

    await reportPlaybackFailure(42, 'decode failed', { autoChangeParse, onPlaybackFailure, notify });

    expect(order).toEqual([
      '流异常（decode failed），正在自动为您切换解析线路…',
      'auto-change',
      'page-failure',
    ]);
    expect(autoChangeParse).toHaveBeenCalledWith(42, 'decode failed', 'media-failure');
    expect(onPlaybackFailure).toHaveBeenCalledWith(42, 'decode failed');
  });

  it('reports rejected failover without leaving an unhandled rejection', async () => {
    const notify = vi.fn();
    const onPlaybackFailure = vi.fn();

    await expect(reportPlaybackFailure(12, 'network error', {
      autoChangeParse: () => Promise.reject(new Error('no more parses')),
      onPlaybackFailure,
      notify,
    })).resolves.toBeUndefined();

    expect(onPlaybackFailure).toHaveBeenCalledWith(12, 'network error');
    expect(notify).toHaveBeenLastCalledWith('自动切换解析线路失败：no more parses');
  });

  it('explains when the automatic parse-switch budget is exhausted', async () => {
    const notify = vi.fn();
    await reportPlaybackFailure(12, 'network error', {
      autoChangeParse: () => Promise.resolve(false),
      notify,
    });

    expect(notify).toHaveBeenNthCalledWith(1, '流异常（network error），正在自动为您切换解析线路…');
    expect(notify).toHaveBeenLastCalledWith('没有可用的备用解析线路，请切换播放源或重新解析当前集');
  });

  it('still reports playback failure when parse failover throws synchronously', async () => {
    const notify = vi.fn();
    const onPlaybackFailure = vi.fn();

    await reportPlaybackFailure(0, 'engine exited', {
      autoChangeParse: () => { throw new Error('session unavailable'); },
      onPlaybackFailure,
      notify,
    });

    expect(onPlaybackFailure).toHaveBeenCalledWith(0, 'engine exited');
    expect(notify).toHaveBeenLastCalledWith('自动切换解析线路失败：session unavailable');
  });

  it('reports delegated playback failures when automatic parse switching is absent', async () => {
    const notify = vi.fn();
    const onPlaybackFailure = vi.fn();

    await reportPlaybackFailure(8, 'stream ended', { onPlaybackFailure, notify });

    expect(onPlaybackFailure).toHaveBeenCalledWith(8, 'stream ended');
    expect(notify).not.toHaveBeenCalled();
  });
});
