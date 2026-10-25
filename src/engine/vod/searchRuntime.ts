// Focused utilities for bounded, fair aggregate-search scheduling.
import { throwIfAborted } from '../util/abort';

type SearchWorkerRelease = () => void;
type SearchWorkerWaiter = {
  profileId: string;
  resolve: (release: SearchWorkerRelease | null) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

/** Fair shared source-worker budget for cross-profile search. */
export class FairProfileWorkerBudget {
  private active = 0;
  private cursor = 0;
  private readonly waiting = new Map<string, SearchWorkerWaiter[]>();
  private readonly profilesAwaitingFirstWorker: Set<string>;

  constructor(
    private readonly limit: number,
    private readonly profileIds: string[],
    initialProfileIds: string[] = profileIds,
  ) {
    this.profilesAwaitingFirstWorker = new Set(initialProfileIds);
  }

  finishProfile(profileId: string): void {
    this.profilesAwaitingFirstWorker.delete(profileId);
    this.dispatch();
  }

  acquire(profileId: string, signal: AbortSignal): Promise<SearchWorkerRelease | null> {
    if (signal.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter: SearchWorkerWaiter = {
        profileId,
        resolve,
        signal,
        onAbort: () => {
          const queue = this.waiting.get(profileId);
          const index = queue?.indexOf(waiter) ?? -1;
          if (index < 0) return;
          queue!.splice(index, 1);
          if (queue!.length === 0) this.waiting.delete(profileId);
          signal.removeEventListener('abort', waiter.onAbort);
          resolve(null);
          this.dispatch();
        },
      };
      const queue = this.waiting.get(profileId) ?? [];
      queue.push(waiter);
      this.waiting.set(profileId, queue);
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.active < this.limit) {
      // Keep one permit available for each selected profile that has not started
      // yet, while letting already-started profiles use the remaining capacity.
      const reservedSlots = Math.min(this.limit, this.profilesAwaitingFirstWorker.size);
      const firstWorkersOnly = this.active >= this.limit - reservedSlots;
      const waiter = this.takeNext(firstWorkersOnly);
      if (!waiter) return;
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal.aborted) {
        waiter.resolve(null);
        continue;
      }
      this.profilesAwaitingFirstWorker.delete(waiter.profileId);
      this.active++;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.dispatch();
      });
    }
  }

  private takeNext(firstWorkersOnly: boolean): SearchWorkerWaiter | null {
    if (this.profileIds.length === 0) return null;
    for (let i = 0; i < this.profileIds.length; i++) {
      const profileId = this.profileIds[this.cursor];
      this.cursor = (this.cursor + 1) % this.profileIds.length;
      if (firstWorkersOnly && !this.profilesAwaitingFirstWorker.has(profileId)) continue;
      const queue = this.waiting.get(profileId);
      const waiter = queue?.shift();
      if (!waiter) continue;
      if (queue && queue.length === 0) this.waiting.delete(profileId);
      return waiter;
    }
    return null;
  }
}

export function throwIfSearchAborted(signal?: AbortSignal): void {
  throwIfAborted(signal);
}

/** Promise 竞速超时（超时即拒；落地后清掉计时器，避免残留定时器） */
export function raceTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
