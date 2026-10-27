export interface MediaRuntimeArchiveWorkerMessage {
  phase?: string;
  listing?: string;
  ok?: boolean;
  error?: string;
}

export interface MediaRuntimeArchiveWorkerPort {
  listenMessages(listener: (message: MediaRuntimeArchiveWorkerMessage) => void): void;
  removeMessages(listener: (message: MediaRuntimeArchiveWorkerMessage) => void): void;
  listenError(listener: (error: Error) => void): void;
  removeError(listener: (error: Error) => void): void;
  listenExit(listener: (code: number) => void): void;
  removeExit(listener: (code: number) => void): void;
  send(message: { type: 'extract' }): void;
  terminate(): Promise<unknown>;
}

/** Coordinate the listing -> validated extraction -> completion worker protocol with one message listener. */
export function runMediaRuntimeArchiveWorker(
  worker: MediaRuntimeArchiveWorkerPort,
  signal: AbortSignal,
  validateListing: (listing: string) => unknown,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
      worker.removeMessages(onMessage);
      worker.removeError(onError);
      worker.removeExit(onExit);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (message: MediaRuntimeArchiveWorkerMessage): void => {
      if (message?.phase === 'listing') {
        try {
          validateListing(message.listing ?? '');
          worker.send({ type: 'extract' });
        } catch (error) {
          void worker.terminate();
          finish(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      if (message?.phase === 'complete' && message.ok) {
        finish();
        void worker.terminate();
        return;
      }
      finish(new Error(message?.error || '发行包预检或解压失败'));
      void worker.terminate();
    };
    const onError = (error: Error): void => {
      finish(error instanceof Error ? error : new Error(String(error)));
      void worker.terminate();
    };
    const onExit = (code: number): void => {
      if (!settled) finish(new Error(code === 0 ? '解压工作线程未返回结果' : '解压工作线程异常退出（' + code + '）'));
    };
    const onAbort = (): void => {
      void worker.terminate().then(
        () => finish(new Error('解压已取消')),
        () => finish(new Error('解压已取消')),
      );
    };

    signal.addEventListener('abort', onAbort, { once: true });
    worker.listenMessages(onMessage);
    worker.listenError(onError);
    worker.listenExit(onExit);
    if (signal.aborted) onAbort();
  });
}
