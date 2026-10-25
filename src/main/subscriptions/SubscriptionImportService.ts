import { randomUUID } from 'node:crypto';
import type { SubscriptionImportProgressEvent } from '../../shared/types';
import type {
  SubscriptionImportProgressPatch,
  SubscriptionImportRunner,
  SubscriptionImportRunnerCheckpoint,
  SubscriptionImportSelection,
} from './SubscriptionImportJobContracts';
export type {
  SubscriptionImportProgressPatch,
  SubscriptionImportRunner,
  SubscriptionImportRunnerCheckpoint,
  SubscriptionImportSelection,
} from './SubscriptionImportJobContracts';

interface InternalSubscriptionImportProgressPatch extends Omit<SubscriptionImportProgressPatch, 'state'> {
  state?: SubscriptionImportProgressEvent['state'];
}

export interface PersistedSubscriptionImportJob {
  progress: SubscriptionImportProgressEvent;
  selection: SubscriptionImportSelection;
  runnerCheckpoint?: SubscriptionImportRunnerCheckpoint;
}

export interface SubscriptionImportJobPersistence {
  load(): PersistedSubscriptionImportJob[];
  save(jobs: PersistedSubscriptionImportJob[]): void;
}

export type SubscriptionImportRunnerFactory = (url: string, name: string) => SubscriptionImportRunner;

interface ImportJob {
  progress: SubscriptionImportProgressEvent;
  controller: AbortController;
  runner: SubscriptionImportRunner | null;
  runnerCheckpoint: SubscriptionImportRunnerCheckpoint;
  selection: SubscriptionImportSelection;
  stopped: boolean;
}

/** Owns import job lifecycle, cancellation, progress snapshots, and retry selection. */
export class SubscriptionImportService {
  private readonly jobs = new Map<string, ImportJob>();

  constructor(
    private readonly publish?: (event: SubscriptionImportProgressEvent) => void,
    private readonly persistence?: SubscriptionImportJobPersistence,
    private readonly runnerFactory?: SubscriptionImportRunnerFactory,
    private readonly onPersistenceError?: (error: unknown) => void,
  ) {
    this.restore();
  }

  start(url: string, name: string, runner: SubscriptionImportRunner): SubscriptionImportProgressEvent {
    this.prune();
    return this.launch(url, name, runner, 'all');
  }

  get(jobId: string): SubscriptionImportProgressEvent | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job.progress } : null;
  }

  list(): SubscriptionImportProgressEvent[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.progress.updatedAt.localeCompare(a.progress.updatedAt))
      .map((job) => ({ ...job.progress }));
  }

  cancel(jobId: string): SubscriptionImportProgressEvent {
    const job = this.requireJob(jobId);
    if (job.progress.state === 'resolving' || job.progress.state === 'running') {
      job.controller.abort(new Error('用户取消了订阅导入'));
      this.update(job, { message: '正在停止当前请求…' });
    }
    return { ...job.progress };
  }

  retryFailed(jobId: string): SubscriptionImportProgressEvent {
    const job = this.requireJob(jobId);
    if (job.progress.failed === 0) throw new Error('当前任务没有失败子仓');
    return this.launch(job.progress.url, job.progress.name, this.runnerFor(job), 'failed', job.runnerCheckpoint);
  }

  continuePending(jobId: string): SubscriptionImportProgressEvent {
    const job = this.requireJob(jobId);
    if (job.progress.pending === 0) throw new Error('当前任务没有待处理子仓');
    return this.launch(job.progress.url, job.progress.name, this.runnerFor(job), 'pending', job.runnerCheckpoint);
  }

  resumeInterrupted(jobId: string): SubscriptionImportProgressEvent {
    const job = this.requireJob(jobId);
    if (job.progress.state !== 'interrupted') throw new Error('当前任务没有中断');
    return this.launch(job.progress.url, job.progress.name, this.runnerFor(job), job.selection, job.runnerCheckpoint);
  }

  dispose(): void {
    for (const job of this.jobs.values()) {
      if (job.progress.state === 'resolving' || job.progress.state === 'running') {
        const state = job.controller.signal.aborted ? 'cancelled' : 'interrupted';
        this.update(job, {
          state,
          message: state === 'interrupted'
            ? '应用关闭时任务中断；恢复时会复用已保存的子仓清单，尚未解析时重新读取订阅配置'
            : '应用退出时任务已取消',
        });
        job.stopped = true;
        job.controller.abort(new Error('应用正在退出'));
      }
    }
  }

  private launch(
    url: string,
    name: string,
    runner: SubscriptionImportRunner,
    selection: SubscriptionImportSelection,
    runnerCheckpoint: SubscriptionImportRunnerCheckpoint = {},
  ): SubscriptionImportProgressEvent {
    if ([...this.jobs.values()].some((job) => job.progress.state === 'resolving' || job.progress.state === 'running')) {
      throw new Error('已有订阅导入任务正在运行');
    }
    const jobId = randomUUID();
    const job: ImportJob = {
      controller: new AbortController(),
      runner,
      runnerCheckpoint: cloneRunnerCheckpoint(runnerCheckpoint),
      selection,
      stopped: false,
      progress: {
        jobId,
        revision: 0,
        url,
        name,
        state: 'resolving',
        total: 0,
        completed: 0,
        succeeded: 0,
        failed: 0,
        pending: 0,
        updatedAt: new Date().toISOString(),
      },
    };
    this.jobs.set(jobId, job);
    this.emit(job);
    this.persist();
    queueMicrotask(() => { void this.execute(job); });
    return { ...job.progress };
  }

  private async execute(job: ImportJob): Promise<void> {
    if (job.stopped) return;
    if (job.controller.signal.aborted) {
      this.update(job, { state: 'cancelled', message: '导入已取消' });
      return;
    }
    this.update(job, { state: 'running', message: '正在读取订阅清单…' });
    try {
      if (!job.runner) throw new Error('没有可用的订阅导入执行器');
      const message = await job.runner(
        job.controller.signal,
        job.selection,
        (patch) => this.updateRunnerProgress(job, patch),
        cloneRunnerCheckpoint(job.runnerCheckpoint),
        (checkpoint) => this.updateRunnerCheckpoint(job, checkpoint),
      );
      if (job.stopped) return;
      if (job.controller.signal.aborted) {
        this.update(job, { state: 'cancelled', message: '导入已取消；本轮结果未提交' });
      } else {
        const allFailed = job.progress.succeeded === 0 && job.progress.failed > 0 && job.progress.pending === 0;
        const partial = job.progress.failed > 0 || job.progress.pending > 0;
        this.update(job, { state: allFailed ? 'failed' : partial ? 'partial' : 'completed', ...(message ? { message } : {}) });
      }
    } catch (error) {
      if (job.stopped) return;
      const cancelled = job.controller.signal.aborted;
      this.update(job, {
        state: cancelled ? 'cancelled' : 'failed',
        message: cancelled
          ? '导入已取消；本轮结果未提交'
          : error instanceof Error ? error.message : String(error),
      });
    }
  }

  private update(job: ImportJob, patch: InternalSubscriptionImportProgressPatch): void {
    if (job.stopped) return;
    job.progress = {
      ...job.progress,
      ...patch,
      revision: job.progress.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.emit(job);
    this.persist();
  }

  private updateRunnerProgress(job: ImportJob, patch: SubscriptionImportProgressPatch): void {
    if (job.progress.state !== 'resolving' && job.progress.state !== 'running') return;
    this.update(job, patch);
  }

  private updateRunnerCheckpoint(job: ImportJob, checkpoint: SubscriptionImportRunnerCheckpoint): void {
    if (job.stopped || (job.progress.state !== 'resolving' && job.progress.state !== 'running')) return;
    job.runnerCheckpoint = cloneRunnerCheckpoint(checkpoint);
    this.persist();
  }

  private emit(job: ImportJob): void {
    try {
      this.publish?.({ ...job.progress });
    } catch {
      // Progress listeners can disappear when all renderer windows close.
    }
  }

  private requireJob(jobId: string): ImportJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('订阅导入任务不存在或已过期');
    return job;
  }

  private runnerFor(job: ImportJob): SubscriptionImportRunner {
    const runner = this.runnerFactory?.(job.progress.url, job.progress.name) ?? job.runner;
    if (!runner) throw new Error('应用重启后无法恢复此任务，请重新导入订阅');
    return runner;
  }

  private restore(): void {
    const saved = this.persistence?.load() ?? [];
    let changed = false;
    for (const item of saved) {
      let progress = { ...item.progress };
      const active = progress.state === 'resolving' || progress.state === 'running';
      if (active) {
        progress = {
          ...progress,
          state: 'interrupted',
          message: '应用重启后任务中断；恢复时会复用已保存的子仓清单，尚未解析时重新读取订阅配置',
          revision: progress.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        changed = true;
      }
      const job: ImportJob = {
        progress,
        controller: new AbortController(),
        runner: null,
        runnerCheckpoint: cloneRunnerCheckpoint(item.runnerCheckpoint ?? {}),
        selection: item.selection,
        stopped: false,
      };
      this.jobs.set(progress.jobId, job);
    }
    this.prune();
    if (changed) this.persist();
  }

  private persist(): void {
    if (!this.persistence) return;
    const jobs = [...this.jobs.values()]
      .sort((a, b) => b.progress.updatedAt.localeCompare(a.progress.updatedAt))
      .map(({ progress, selection, runnerCheckpoint }) => ({
        progress: { ...progress },
        selection,
        ...(runnerCheckpoint.multiRepoItems ? { runnerCheckpoint: cloneRunnerCheckpoint(runnerCheckpoint) } : {}),
      }));
    try {
      this.persistence.save(jobs);
    } catch (error) {
      this.onPersistenceError?.(error);
    }
  }

  private prune(): void {
    const terminal = [...this.jobs.entries()]
      .filter(([, job]) => !['resolving', 'running'].includes(job.progress.state))
      .sort((a, b) => a[1].progress.updatedAt.localeCompare(b[1].progress.updatedAt));
    while (terminal.length > 20) {
      const [jobId] = terminal.shift()!;
      this.jobs.delete(jobId);
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [jobId, job] of this.jobs) {
      if (job.progress.state === 'resolving' || job.progress.state === 'running') continue;
      if (Date.parse(job.progress.updatedAt) < cutoff) this.jobs.delete(jobId);
    }
  }
}

function cloneRunnerCheckpoint(checkpoint: SubscriptionImportRunnerCheckpoint): SubscriptionImportRunnerCheckpoint {
  return checkpoint.multiRepoItems
    ? { multiRepoItems: checkpoint.multiRepoItems.map((item) => ({ ...item })) }
    : {};
}
