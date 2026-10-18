interface QuitEvent {
  preventDefault(): void;
}
interface QuitApplication {
  on(event: 'will-quit', listener: (event: QuitEvent) => void): unknown;
  quit(): void;
}

/** Wait for bounded async cleanup, then retry quitting after Electron leaves the current event. */
export function registerAppQuitCleanup(app: QuitApplication, options: {
  cleanup(): unknown | Promise<unknown>;
  dispose(): void;
  timeoutMs?: number;
  onError?(error: unknown): void;
}): void {
  let phase: 'initial' | 'cleaning' | 'ready' = 'initial';
  let disposed = false;
  app.on('will-quit', (event) => {
    if (phase === 'ready') {
      if (!disposed) {
        disposed = true;
        try { options.dispose(); } catch (error) { options.onError?.(error); }
      }
      return;
    }
    event.preventDefault();
    if (phase === 'cleaning') return;
    phase = 'cleaning';
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<void>((resolveDeadline) => {
      timer = setTimeout(resolveDeadline, options.timeoutMs ?? 8000);
    });
    void Promise.race([Promise.resolve().then(() => options.cleanup()), deadline])
      .catch(error => options.onError?.(error))
      .finally(() => {
        clearTimeout(timer);
        phase = 'ready';
        setImmediate(() => app.quit());
      });
  });
}
