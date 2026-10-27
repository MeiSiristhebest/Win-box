// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';

function installVodApi(vod: Record<string, unknown>): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { vod },
  });
}

describe('renderer VOD browse cancellation bridge', () => {
  it('attaches a request id and sends home cancellation when the session signal aborts', async () => {
    const home = vi.fn((_key: string, _profileId: string | undefined, requestId: string) => {
      expect(requestId).toBeTruthy();
      return new Promise<never>(() => undefined);
    });
    const cancelHome = vi.fn();
    installVodApi({ home, cancelHome });
    const controller = new AbortController();

    const request = client.home('source-a', 'profile-a', controller.signal);
    controller.abort(new Error('home superseded'));

    expect(cancelHome).toHaveBeenCalledWith(home.mock.calls[0]?.[2]);
    await expect(request).rejects.toMatchObject({ name: 'AbortError', message: 'home superseded' });
  });

  it('attaches a request id to category requests and sends category cancellation', async () => {
    const category = vi.fn((args: { key: string; requestId?: string }) => {
      expect(args.requestId).toBeTruthy();
      return new Promise<never>(() => undefined);
    });
    const cancelCategory = vi.fn();
    installVodApi({ category, cancelCategory });
    const controller = new AbortController();

    const request = client.category({ key: 'source-a', tid: 'genre', pg: '2' }, controller.signal);
    controller.abort(new Error('category superseded'));

    expect(cancelCategory).toHaveBeenCalledWith(category.mock.calls[0]?.[0].requestId);
    await expect(request).rejects.toMatchObject({ name: 'AbortError', message: 'category superseded' });
  });
});
