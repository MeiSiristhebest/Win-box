import { describe, expect, it, vi } from 'vitest';
import { registerAppQuitCleanup } from '../src/main/util/appQuit';

class QuitApp {
  private listener!: (event: { preventDefault(): void }) => void;
  private quitting = false;
  exited = false;
  on(_event: 'will-quit', listener: (event: { preventDefault(): void }) => void) { this.listener = listener; }
  quit() {
    // Electron clears its current quit attempt only after the JS event returns.
    if (this.quitting) return;
    this.quitting = true;
    let prevented = false;
    this.listener({ preventDefault() { prevented = true; } });
    setImmediate(() => {
      this.quitting = false;
      if (!prevented) this.exited = true;
    });
  }
}

describe('application quit cleanup', () => {
  it('retries on the next event-loop turn when cleanup completes immediately', async () => {
    const app = new QuitApp();
    const cleanup = vi.fn(() => Promise.resolve());
    const dispose = vi.fn();
    registerAppQuitCleanup(app, { cleanup, dispose });
    app.quit();
    await vi.waitFor(() => expect(app.exited).toBe(true));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps repeated quit attempts waiting for the same cleanup', async () => {
    const app = new QuitApp();
    let finish!: () => void;
    const cleanup = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const dispose = vi.fn();
    registerAppQuitCleanup(app, { cleanup, dispose });
    app.quit();
    await new Promise<void>(resolve => setImmediate(resolve));
    app.quit();
    expect(dispose).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(app.exited).toBe(true));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('reports cleanup rejection and still exits', async () => {
    const app = new QuitApp();
    const error = new Error('cleanup failed');
    const onError = vi.fn();
    const dispose = vi.fn();
    registerAppQuitCleanup(app, { cleanup: () => Promise.reject(error), dispose, onError });
    app.quit();
    await vi.waitFor(() => expect(app.exited).toBe(true));
    expect(onError).toHaveBeenCalledWith(error);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('exits after the deadline when cleanup does not settle', async () => {
    const app = new QuitApp();
    const dispose = vi.fn();
    registerAppQuitCleanup(app, { cleanup: () => new Promise(() => {}), dispose, timeoutMs: 10 });
    app.quit();
    await vi.waitFor(() => expect(app.exited).toBe(true));
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
