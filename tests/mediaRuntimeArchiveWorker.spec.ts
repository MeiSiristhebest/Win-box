import { describe, expect, it, vi } from 'vitest';
import {
  runMediaRuntimeArchiveWorker,
  type MediaRuntimeArchiveWorkerMessage,
  type MediaRuntimeArchiveWorkerPort,
} from '../src/main/player/mediaRuntimeArchiveWorker';

class FakeArchiveWorker implements MediaRuntimeArchiveWorkerPort {
  messages: Array<(message: MediaRuntimeArchiveWorkerMessage) => void> = [];
  errors: Array<(error: Error) => void> = [];
  exits: Array<(code: number) => void> = [];
  sent: Array<{ type: 'extract' }> = [];
  terminate = vi.fn(async () => 0);

  listenMessages(listener: (message: MediaRuntimeArchiveWorkerMessage) => void): void { this.messages.push(listener); }
  removeMessages(listener: (message: MediaRuntimeArchiveWorkerMessage) => void): void { this.messages = this.messages.filter((entry) => entry !== listener); }
  listenError(listener: (error: Error) => void): void { this.errors.push(listener); }
  removeError(listener: (error: Error) => void): void { this.errors = this.errors.filter((entry) => entry !== listener); }
  listenExit(listener: (code: number) => void): void { this.exits.push(listener); }
  removeExit(listener: (code: number) => void): void { this.exits = this.exits.filter((entry) => entry !== listener); }
  send(message: { type: 'extract' }): void { this.sent.push(message); }

  emitMessage(message: MediaRuntimeArchiveWorkerMessage): void {
    for (const listener of this.messages.slice()) listener(message);
  }
}

describe('runMediaRuntimeArchiveWorker', () => {
  it('waits for listing validation, requests extraction once, then resolves only on completion', async () => {
    const worker = new FakeArchiveWorker();
    const controller = new AbortController();
    const validateListing = vi.fn((listing: string) => {
      if (listing !== 'safe listing') throw new Error('invalid listing');
    });
    let settled = false;
    const completion = runMediaRuntimeArchiveWorker(worker, controller.signal, validateListing).then(() => { settled = true; });

    worker.emitMessage({ phase: 'listing', listing: 'safe listing' });
    await Promise.resolve();
    expect(validateListing).toHaveBeenCalledWith('safe listing');
    expect(worker.sent).toEqual([{ type: 'extract' }]);
    expect(worker.messages).toHaveLength(1);
    expect(settled).toBe(false);

    worker.emitMessage({ phase: 'complete', ok: true });
    await completion;
    expect(settled).toBe(true);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.messages).toHaveLength(0);
  });

  it('terminates without requesting extraction when listing validation rejects the archive', async () => {
    const worker = new FakeArchiveWorker();
    const completion = runMediaRuntimeArchiveWorker(worker, new AbortController().signal, () => { throw new Error('unsafe archive'); });

    worker.emitMessage({ phase: 'listing', listing: 'unsafe listing' });

    await expect(completion).rejects.toThrow('unsafe archive');
    expect(worker.sent).toEqual([]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
