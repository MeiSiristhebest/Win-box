import type { SearchAllProgressEvent, SearchAllReport } from '../../shared/types';

type PendingSearch = {
  promise: Promise<SearchAllReport>;
  listeners: Set<(event: SearchAllProgressEvent) => void>;
};

/** Coalesces identical in-flight searches and fans progress out to each caller. */
export class AggregateSearchRequestBroker {
  private readonly pending = new Map<string, PendingSearch>();

  clear(): void {
    this.pending.clear();
  }

  run(
    key: string,
    execute: (publish: (event: SearchAllProgressEvent) => void) => Promise<SearchAllReport>,
    listener?: (event: SearchAllProgressEvent) => void,
  ): Promise<SearchAllReport> {
    let pending = this.pending.get(key);
    if (!pending) {
      const listeners = new Set<(event: SearchAllProgressEvent) => void>();
      const job: PendingSearch = {
        listeners,
        promise: Promise.resolve()
          .then(() => execute((event) => this.publish(listeners, event)))
          .finally(() => {
            if (this.pending.get(key) === job) this.pending.delete(key);
            listeners.clear();
          }),
      };
      this.pending.set(key, job);
      pending = job;
    }

    if (listener) pending.listeners.add(listener);
    return pending.promise.finally(() => {
      if (listener) pending?.listeners.delete(listener);
    });
  }

  private publish(listeners: Set<(event: SearchAllProgressEvent) => void>, event: SearchAllProgressEvent): void {
    for (const listener of listeners) {
      try { listener(event); } catch { /* A disconnected renderer must not stop other progress subscribers. */ }
    }
  }
}
