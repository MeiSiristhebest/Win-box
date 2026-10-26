import type { SearchAllProgressEvent, SearchAllReport } from '../../shared/types';

type Subscriber = {
  listener?: (event: SearchAllProgressEvent) => void;
  resolve(value: SearchAllReport): void;
  reject(reason: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
  settled: boolean;
};

type PendingSearch = {
  key: string;
  controller: AbortController;
  subscribers: Set<Subscriber>;
  execute: (publish: (event: SearchAllProgressEvent) => void, signal: AbortSignal) => Promise<SearchAllReport>;
  state: 'queued' | 'running' | 'settled';
};

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : '全源搜索失败');
}

function abortError(reason?: unknown): Error {
  const source = asError(reason ?? '搜索已取消');
  if (source.name === 'AbortError') return source;
  const error = new Error(source.message);
  error.name = 'AbortError';
  (error as Error & { cause?: unknown }).cause = source;
  return error;
}

/** Coalesces identical searches, tracks each waiter, and bounds concurrent backend jobs. */
export class AggregateSearchRequestBroker {
  private readonly pending = new Map<string, PendingSearch>();
  private readonly queue: PendingSearch[] = [];
  private activeCount = 0;

  constructor(private readonly maxConcurrent = 2, private readonly maxQueued = 16) {}

  clear(): void {
    const jobs = new Set(this.pending.values());
    this.pending.clear();
    this.queue.length = 0;
    for (const job of jobs) this.cancelJob(job, new Error('搜索配置已变更'));
    this.pump();
  }

  run(
    key: string,
    execute: (publish: (event: SearchAllProgressEvent) => void, signal: AbortSignal) => Promise<SearchAllReport>,
    listener?: (event: SearchAllProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<SearchAllReport> {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));

    let job = this.pending.get(key);
    if (job?.controller.signal.aborted) job = undefined;
    if (!job) {
      if (this.queue.length >= this.maxQueued && this.activeCount >= this.maxConcurrent) {
        return Promise.reject(new Error('全源搜索队列已满，请稍后重试'));
      }
      job = {
        key,
        controller: new AbortController(),
        subscribers: new Set(),
        execute,
        state: 'queued',
      };
      this.pending.set(key, job);
      this.queue.push(job);
    }

    const request = new Promise<SearchAllReport>((resolve, reject) => {
      const subscriber: Subscriber = { listener, resolve, reject, signal, settled: false };
      job!.subscribers.add(subscriber);
      if (signal) {
        subscriber.onAbort = () => this.cancelSubscriber(job!, subscriber, abortError(signal.reason));
        signal.addEventListener('abort', subscriber.onAbort, { once: true });
        if (signal.aborted) subscriber.onAbort();
      }
    });
    this.pump();
    return request;
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job || job.state !== 'queued' || job.subscribers.size === 0) continue;
      job.state = 'running';
      this.activeCount++;
      void Promise.resolve()
        .then(() => {
          if (job.controller.signal.aborted) throw abortError(job.controller.signal.reason);
          return job.execute((event) => this.publish(job, event), job.controller.signal);
        })
        .then(
          (report) => this.finish(job, undefined, report),
          (error: unknown) => this.finish(job, asError(error)),
        );
    }
  }

  private finish(job: PendingSearch, error?: Error, report?: SearchAllReport): void {
    if (job.state === 'settled') return;
    const wasRunning = job.state === 'running';
    job.state = 'settled';
    if (this.pending.get(job.key) === job) this.pending.delete(job.key);
    for (const subscriber of job.subscribers) {
      this.detach(job, subscriber);
      if (error) subscriber.reject(error);
      else subscriber.resolve(report!);
    }
    job.subscribers.clear();
    if (wasRunning) this.activeCount = Math.max(0, this.activeCount - 1);
    this.pump();
  }

  private cancelSubscriber(job: PendingSearch, subscriber: Subscriber, error: Error): void {
    if (subscriber.settled) return;
    this.detach(job, subscriber);
    subscriber.reject(error);
    if (job.subscribers.size > 0) return;

    if (this.pending.get(job.key) === job) this.pending.delete(job.key);
    job.controller.abort(error);
    if (job.state === 'queued') {
      job.state = 'settled';
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
      this.pump();
    }
    // Running work keeps its global permit until its abort-aware backend exits.
  }

  private cancelJob(job: PendingSearch, error: Error): void {
    if (job.state === 'settled') return;
    const cancellation = abortError(error);
    job.controller.abort(cancellation);
    for (const subscriber of job.subscribers) {
      this.detach(job, subscriber);
      subscriber.reject(cancellation);
    }
    job.subscribers.clear();
    if (job.state === 'queued') {
      job.state = 'settled';
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
    }
  }

  private detach(job: PendingSearch, subscriber: Subscriber): void {
    if (subscriber.settled) return;
    subscriber.settled = true;
    if (subscriber.onAbort) subscriber.signal?.removeEventListener('abort', subscriber.onAbort);
    job.subscribers.delete(subscriber);
  }

  private publish(job: PendingSearch, event: SearchAllProgressEvent): void {
    if (job.controller.signal.aborted) return;
    for (const subscriber of job.subscribers) {
      try { subscriber.listener?.(event); } catch { /* A disconnected renderer must not stop other progress subscribers. */ }
    }
  }
}
