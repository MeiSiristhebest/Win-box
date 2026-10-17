/** A bounded wait that releases its timer when either side settles. */
export async function withTimeout<T>(task: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => timeout.reject(new Error(message)), timeoutMs);
  timer.unref();
  try {
    return await Promise.race([Promise.resolve(task), timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}
