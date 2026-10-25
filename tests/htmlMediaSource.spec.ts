import { describe, expect, it, vi } from 'vitest';
import { createHtmlMediaPreparation, type HtmlMediaSourcePort, type PreparedHtmlMediaSource } from '../src/renderer/features/playback/application/htmlMediaSource';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function port(): HtmlMediaSourcePort {
  return { requiresPreparation: () => true, prepare: vi.fn(async (url) => ({ source: url, url: 'prepared' })), release: vi.fn() };
}

describe('HTML media preparation ownership', () => {
  it('bypasses the compatibility provider for an already playable direct URL', async () => {
    const source = { ...port(), requiresPreparation: () => false };
    const preparation = createHtmlMediaPreparation('direct', source);
    expect(preparation.requiresPreparation).toBe(false);
    await expect(preparation.result).resolves.toEqual({ source: 'direct', url: 'direct' });
    preparation.dispose();
    expect(source.prepare).not.toHaveBeenCalled();
    expect(source.release).not.toHaveBeenCalled();
  });

  it('does not start a provider request if the scope is disposed before it starts', async () => {
    const source = port();
    const preparation = createHtmlMediaPreparation('original', source);
    preparation.dispose();
    await expect(preparation.result).resolves.toBeNull();
    expect(source.prepare).not.toHaveBeenCalled();
  });

  it('aborts a cancelled request and releases a lease that arrives afterwards exactly once', async () => {
    const pending = deferred<PreparedHtmlMediaSource>();
    const source = port();
    let signal!: AbortSignal;
    source.prepare = vi.fn((_url, cancellation) => { signal = cancellation; return pending.promise; });
    const preparation = createHtmlMediaPreparation('original', source);
    await Promise.resolve();
    preparation.dispose();
    expect(signal.aborted).toBe(true);
    pending.resolve({ source: 'original', url: 'compatibility', sessionReleaseUrl: 'release-old' });
    await expect(preparation.result).resolves.toBeNull();
    preparation.dispose();
    expect(source.release).toHaveBeenCalledExactlyOnceWith('release-old');
  });

  it('owns a completed lease until playback releases it, with idempotent cleanup', async () => {
    const source = port();
    source.prepare = vi.fn(async (url) => ({ source: url, url: 'compatibility', sessionReleaseUrl: 'release-active' }));
    const preparation = createHtmlMediaPreparation('original', source);
    await expect(preparation.result).resolves.toMatchObject({ url: 'compatibility' });
    expect(source.release).not.toHaveBeenCalled();
    preparation.dispose();
    preparation.dispose();
    expect(source.release).toHaveBeenCalledExactlyOnceWith('release-active');
  });

  it('propagates a current provider failure while suppressing a failure from a disposed scope', async () => {
    const current = deferred<PreparedHtmlMediaSource>();
    const source = { ...port(), prepare: vi.fn(() => current.promise) };
    const preparation = createHtmlMediaPreparation('original', source);
    const failure = new Error('Upstream rejected');
    current.reject(failure);
    await expect(preparation.result).rejects.toBe(failure);

    const late = deferred<PreparedHtmlMediaSource>();
    source.prepare.mockReturnValue(late.promise);
    const cancelled = createHtmlMediaPreparation('old', source);
    await Promise.resolve();
    cancelled.dispose();
    late.reject(failure);
    await expect(cancelled.result).resolves.toBeNull();
  });

  it('does not let a cleanup adapter failure escape from disposal', async () => {
    const source = port();
    source.prepare = vi.fn(async (url) => ({ source: url, url: 'compatibility', sessionReleaseUrl: 'release' }));
    source.release = vi.fn(() => { throw new Error('Network adapter closed'); });
    const preparation = createHtmlMediaPreparation('original', source);
    await preparation.result;
    expect(() => preparation.dispose()).not.toThrow();
    preparation.dispose();
    expect(source.release).toHaveBeenCalledOnce();
  });
});
