import { describe, expect, it } from 'vitest';
import { abortError, awaitWithAbort } from '../src/engine/util/abort';

describe('abort error contract', () => {
  it('normalizes an Error abort reason while preserving its message and cause', () => {
    const reason = new Error('query superseded');
    const controller = new AbortController();
    controller.abort(reason);

    const error = abortError(controller.signal) as Error & { cause?: unknown };
    expect(error).toMatchObject({ name: 'AbortError', message: 'query superseded' });
    expect(error).not.toBe(reason);
    expect(error.cause).toBe(reason);
  });

  it('normalizes string and default abort reasons', () => {
    const withMessage = new AbortController();
    withMessage.abort('superseded');
    expect(abortError(withMessage.signal)).toMatchObject({ name: 'AbortError', message: 'superseded' });

    const withoutMessage = new AbortController();
    withoutMessage.abort();
    expect(abortError(withoutMessage.signal)).toMatchObject({ name: 'AbortError' });
  });

  it('rejects an aborted waiter as AbortError without cancelling the shared task', async () => {
    const controller = new AbortController();
    let finish!: (value: string) => void;
    const sharedTask = new Promise<string>(resolve => { finish = resolve; });
    const waiter = awaitWithAbort(sharedTask, controller.signal);

    controller.abort(new Error('query superseded'));
    await expect(waiter).rejects.toMatchObject({ name: 'AbortError', message: 'query superseded' });

    finish('ready');
    await expect(sharedTask).resolves.toBe('ready');
  });
});
