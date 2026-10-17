import type { SubscriptionImportProgressEvent, SubscriptionImportJobState } from '../../shared/types';
import { JsonStore } from '../store/JsonStore';
import type {
  PersistedSubscriptionImportJob,
  SubscriptionImportRunnerCheckpoint,
  SubscriptionImportJobPersistence,
  SubscriptionImportSelection,
} from './SubscriptionImportService';

const STORE_KEY = 'jobs';
const JOB_STATES = new Set<SubscriptionImportJobState>([
  'resolving',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
]);
const SELECTIONS = new Set<SubscriptionImportSelection>(['all', 'failed', 'pending']);

function isProgressEvent(value: unknown): value is SubscriptionImportProgressEvent {
  if (value == null || typeof value !== 'object') return false;
  const event = value as Partial<SubscriptionImportProgressEvent>;
  return typeof event.jobId === 'string'
    && typeof event.revision === 'number'
    && typeof event.url === 'string'
    && typeof event.name === 'string'
    && typeof event.state === 'string'
    && JOB_STATES.has(event.state as SubscriptionImportJobState)
    && ['total', 'completed', 'succeeded', 'failed', 'pending'].every((key) =>
      typeof event[key as keyof SubscriptionImportProgressEvent] === 'number')
    && typeof event.updatedAt === 'string';
}

function isPersistedJob(value: unknown): value is PersistedSubscriptionImportJob {
  if (value == null || typeof value !== 'object') return false;
  const job = value as Partial<PersistedSubscriptionImportJob>;
  return isProgressEvent(job.progress)
    && typeof job.selection === 'string'
    && SELECTIONS.has(job.selection as SubscriptionImportSelection)
    && (job.runnerCheckpoint === undefined || isRunnerCheckpoint(job.runnerCheckpoint));
}

function isRunnerCheckpoint(value: unknown): value is SubscriptionImportRunnerCheckpoint {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as Partial<SubscriptionImportRunnerCheckpoint>;
  return checkpoint.multiRepoItems === undefined || (Array.isArray(checkpoint.multiRepoItems)
    && checkpoint.multiRepoItems.every((item) => item != null
      && typeof item === 'object'
      && typeof item.url === 'string'
      && (item.name === undefined || typeof item.name === 'string')));
}

/** Stores recent task snapshots separately from the user's imported configuration. */
export class SubscriptionImportJobStore implements SubscriptionImportJobPersistence {
  constructor(private readonly store: JsonStore) {}

  load(): PersistedSubscriptionImportJob[] {
    const value = this.store.getObject<unknown>(STORE_KEY, []);
    return Array.isArray(value) ? value.filter(isPersistedJob) : [];
  }

  save(jobs: PersistedSubscriptionImportJob[]): void {
    this.store.setObject(STORE_KEY, jobs.slice(0, 20));
    this.store.flushStrict();
  }
}
