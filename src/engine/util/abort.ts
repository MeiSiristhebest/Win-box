/** Normalize an aborted operation to one stable error contract without depending on DOMException. */
export function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === 'string' && reason
      ? reason
      : '操作已取消';
  const error = new Error(message);
  error.name = 'AbortError';
  if (reason instanceof Error) {
    (error as Error & { cause?: unknown }).cause = reason;
  }
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/**
 * Stop waiting when a caller is aborted without cancelling a promise shared by
 * other callers (for example, a single-flight script load).
 */
export function awaitWithAbort<T>(task: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(task);
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };
    const onAbort = (): void => finish(() => reject(abortError(signal)));

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    Promise.resolve(task).then(
      (value) => finish(() => signal.aborted ? reject(abortError(signal)) : resolve(value)),
      (error: unknown) => finish(() => signal.aborted ? reject(abortError(signal)) : reject(error)),
    );
  });
}
