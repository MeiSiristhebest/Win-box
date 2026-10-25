import { awaitWithAbort } from './abort';

/** A bounded wait that releases its timer when either side settles. */
export async function withTimeout<T>(
  task: PromiseLike<T>,
  timeoutMs: number,
  timeoutError: string | Error,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => timeout.reject(typeof timeoutError === 'string' ? new Error(timeoutError) : timeoutError),
    timeoutMs,
  );
  timer.unref();
  try {
    return await awaitWithAbort(Promise.race([Promise.resolve(task), timeout.promise]), signal);
  } finally {
    clearTimeout(timer);
  }
}
